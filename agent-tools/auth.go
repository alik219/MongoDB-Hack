package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"slices"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
)

// Identity comes only from a token the Recall.IQ app signed for the logged-in user.
// Format (shared with src/lib/voice-token.ts): base64url(json{uid,exp}) + "." + hex(hmac_sha256(secret, payload)).

type tokenClaims struct {
	UID string `json:"uid"`
	Exp int64  `json:"exp"`
}

var errUnauthenticated = errors.New("unauthenticated")

func verifyToken(secret, token string, now time.Time) (string, error) {
	payload, sig, ok := strings.Cut(strings.TrimSpace(token), ".")
	if !ok || payload == "" || sig == "" {
		return "", errUnauthenticated
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(payload))
	want := hex.EncodeToString(mac.Sum(nil))
	if subtle.ConstantTimeCompare([]byte(want), []byte(sig)) != 1 {
		return "", errUnauthenticated
	}
	raw, err := base64.RawURLEncoding.DecodeString(payload)
	if err != nil {
		return "", errUnauthenticated
	}
	var c tokenClaims
	if json.Unmarshal(raw, &c) != nil || c.UID == "" || now.Unix() > c.Exp {
		return "", errUnauthenticated
	}
	return c.UID, nil
}

// signToken is used by tests and by the local dev helper (go run . -mint usr_tomas).
func signToken(secret, uid string, ttl time.Duration, now time.Time) string {
	raw, _ := json.Marshal(tokenClaims{UID: uid, Exp: now.Add(ttl).Unix()})
	payload := base64.RawURLEncoding.EncodeToString(raw)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(payload))
	return payload + "." + hex.EncodeToString(mac.Sum(nil))
}

type User struct {
	ID        string   `bson:"_id" json:"id"`
	FirmID    string   `bson:"firmId" json:"firmId"`
	Name      string   `bson:"name" json:"name"`
	Title     string   `bson:"title" json:"title"`
	Role      string   `bson:"role" json:"role"`
	ClientIDs []string `bson:"clientIds" json:"clientIds"`
}

type Client struct {
	ID          string   `bson:"_id" json:"id"`
	FirmID      string   `bson:"firmId" json:"-"`
	Name        string   `bson:"name" json:"name"`
	Segment     string   `bson:"segment,omitempty" json:"segment,omitempty"`
	LeadAdvisor string   `bson:"leadAdvisorId" json:"-"`
	TeamUserIDs []string `bson:"teamUserIds" json:"-"`
	ExternalID  string   `bson:"externalId,omitempty" json:"externalId,omitempty"`
}

type apiError struct {
	Status  int
	Message string
}

func (e *apiError) Error() string { return e.Message }

// authorizeClient mirrors src/lib/auth.ts: another firm's client is "not found"; an unassigned client is "forbidden".
func authorizeClient(ctx context.Context, db *mongo.Database, u *User, clientID string) (*Client, error) {
	var c Client
	err := db.Collection("clients").FindOne(ctx, bson.M{"_id": clientID, "firmId": u.FirmID}).Decode(&c)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, &apiError{404, "Client not found."}
	}
	if err != nil {
		return nil, err
	}
	if !slices.Contains(u.ClientIDs, c.ID) || !slices.Contains(c.TeamUserIDs, u.ID) {
		return nil, &apiError{403, "You are not assigned to this client."}
	}
	return &c, nil
}
