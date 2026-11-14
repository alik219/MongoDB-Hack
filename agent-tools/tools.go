package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"regexp"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
)

type Server struct {
	cfg  Config
	db   *mongo.Database
	http *http.Client
	now  func() time.Time
}

func (s *Server) clock() time.Time {
	if s.now != nil {
		return s.now()
	}
	return time.Now()
}

func (s *Server) embeddingID() string {
	return fmt.Sprintf("%s:%s:%d", s.cfg.EmbeddingProvider, s.cfg.EmbeddingModel, s.cfg.EmbeddingDims)
}

func (s *Server) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 200, map[string]string{"ok": "true", "embeddings": s.embeddingID()})
	})
	mux.HandleFunc("POST /tools/list_clients", s.tool("list_clients", s.listClients))
	mux.HandleFunc("POST /tools/search_memory", s.tool("search_memory", s.searchMemory))
	mux.HandleFunc("POST /tools/prepare_follow_ups", s.tool("prepare_follow_ups", s.prepareFollowUps))
	mux.HandleFunc("POST /tools/propose_memory", s.tool("propose_memory", s.proposeMemory))
	return mux
}

type toolFn func(ctx context.Context, u *User, body map[string]any) (any, string, error)

// tool wraps every handler: shared-secret check, identity from the signed token, JSON in/out, audit.
func (s *Server) tool(name string, fn toolFn) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if s.cfg.ToolsSharedSecret != "" &&
			subtle.ConstantTimeCompare([]byte(r.Header.Get("X-Tools-Secret")), []byte(s.cfg.ToolsSharedSecret)) != 1 {
			writeJSON(w, 401, map[string]string{"error": "Missing or wrong tools secret."})
			return
		}
		uid, err := verifyToken(s.cfg.TokenSecret, r.Header.Get("X-Session-Token"), s.clock())
		if err != nil {
			writeJSON(w, 401, map[string]string{"error": "Session expired or invalid. Ask the advisor to restart the voice session from Recall.IQ."})
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 110*time.Second)
		defer cancel()
		var u User
		if err := s.db.Collection("users").FindOne(ctx, bson.M{"_id": uid}).Decode(&u); err != nil {
			writeJSON(w, 401, map[string]string{"error": "Unknown user."})
			return
		}
		body := map[string]any{}
		_ = json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&body)
		out, clientID, err := fn(ctx, &u, body)
		s.audit(ctx, &u, "voice."+name, clientID, err)
		if err != nil {
			var ae *apiError
			if errors.As(err, &ae) {
				writeJSON(w, ae.Status, map[string]string{"error": ae.Message})
				return
			}
			log.Printf("tool %s failed: %v", name, err)
			writeJSON(w, 500, map[string]string{"error": "The tool failed. Nothing was changed."})
			return
		}
		writeJSON(w, 200, out)
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func str(body map[string]any, k string) string {
	v, _ := body[k].(string)
	return strings.TrimSpace(v)
}

func newID(prefix string) string {
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	return prefix + "_" + hex.EncodeToString(b)
}

// audit records who called which tool on which client. No memory text is stored.
func (s *Server) audit(ctx context.Context, u *User, typ, clientID string, err error) {
	details := bson.M{"via": "elevenlabs-voice"}
	if err != nil {
		details["error"] = err.Error()
	}
	doc := bson.M{"_id": newID("aud"), "firmId": u.FirmID, "actorId": u.ID, "type": typ, "targetId": clientID, "at": s.clock().UTC().Format(time.RFC3339Nano), "details": details}
	if clientID != "" {
		doc["clientId"] = clientID
	}
	if _, e := s.db.Collection("audit_events").InsertOne(ctx, doc); e != nil {
		log.Printf("audit write failed: %v", e)
	}
}

// ---------- list_clients ----------

func (s *Server) listClients(ctx context.Context, u *User, _ map[string]any) (any, string, error) {
	cur, err := s.db.Collection("clients").Find(ctx, bson.M{"firmId": u.FirmID, "_id": bson.M{"$in": u.ClientIDs}, "teamUserIds": u.ID})
	if err != nil {
		return nil, "", err
	}
	var cs []Client
	if err := cur.All(ctx, &cs); err != nil {
		return nil, "", err
	}
	return map[string]any{"user": u.Name, "clients": cs}, "", nil
}

// ---------- search_memory ----------

type memoryHit struct {
	ID         string   `bson:"_id" json:"memoryId"`
	Version    int      `bson:"version" json:"version"`
	Category   string   `bson:"category" json:"category"`
	Statement  string   `bson:"statement" json:"statement"`
	Basis      string   `bson:"basis" json:"basis"`
	FirmID     string   `bson:"firmId" json:"-"`
	ClientID   string   `bson:"clientId" json:"-"`
	Status     string   `bson:"status" json:"-"`
	Visibility string   `bson:"visibility" json:"-"`
	Allowed    []string `bson:"allowedUserIds" json:"-"`
	ExpiresAt  *string  `bson:"expiresAt" json:"-"`
	ReviewAt   *string  `bson:"reviewAt" json:"reviewAt,omitempty"`
	Score      float64  `bson:"score" json:"similarity"`
}

// retrievalFilter mirrors src/lib/policy.ts: scope, lifecycle, expiry, embedding model and access,
// all inside $vectorSearch so a private memory never becomes a candidate.
func retrievalFilter(u *User, clientID string, now time.Time, embeddingID string) bson.M {
	return bson.M{"$and": bson.A{
		bson.M{"firmId": u.FirmID},
		bson.M{"clientId": clientID},
		bson.M{"status": "active"},
		bson.M{"embeddingModel": embeddingID},
		bson.M{"retrievalExpiresAt": bson.M{"$gt": now}},
		bson.M{"$or": bson.A{bson.M{"visibility": "team"}, bson.M{"allowedUserIds": u.ID}}},
	}}
}

// eligible is the in-code re-check (defense in depth).
func eligible(m memoryHit, u *User, clientID string, now time.Time) bool {
	if m.FirmID != u.FirmID || m.ClientID != clientID || m.Status != "active" {
		return false
	}
	if m.ExpiresAt != nil && *m.ExpiresAt != "" {
		if t, err := time.Parse(time.RFC3339Nano, *m.ExpiresAt); err == nil && !t.After(now) {
			return false
		}
	}
	if m.Visibility == "team" {
		return true
	}
	for _, id := range m.Allowed {
		if id == u.ID {
			return true
		}
	}
	return false
}

func (s *Server) searchMemory(ctx context.Context, u *User, body map[string]any) (any, string, error) {
	clientID := str(body, "client_id")
	query := str(body, "query")
	if clientID == "" || len(query) < 2 {
		return nil, clientID, &apiError{400, "client_id and query are required."}
	}
	c, err := authorizeClient(ctx, s.db, u, clientID)
	if err != nil {
		return nil, clientID, err
	}
	now := s.clock()
	text := c.Name + ". " + query
	vs := bson.M{
		"index":         s.cfg.VectorIndex,
		"numCandidates": 200,
		"limit":         10,
		"filter":        retrievalFilter(u, clientID, now, s.embeddingID()),
	}
	if s.cfg.EmbeddingProvider == "atlas-auto" {
		vs["path"] = "embeddingText"
		vs["query"] = bson.M{"text": text}
	} else {
		vec, err := s.voyageEmbed(ctx, text)
		if err != nil {
			return nil, clientID, err
		}
		vs["path"] = "embedding"
		vs["queryVector"] = vec
	}
	cur, err := s.db.Collection("memories").Aggregate(ctx, mongo.Pipeline{
		{{Key: "$vectorSearch", Value: vs}},
		{{Key: "$set", Value: bson.M{"score": bson.M{"$meta": "vectorSearchScore"}}}},
		{{Key: "$project", Value: bson.M{"embedding": 0, "embeddingText": 0, "evidence": 0}}},
	})
	if err != nil {
		return nil, clientID, err
	}
	var hits []memoryHit
	if err := cur.All(ctx, &hits); err != nil {
		return nil, clientID, err
	}
	out := []memoryHit{}
	for _, h := range hits {
		if eligible(h, u, clientID, now) {
			out = append(out, h)
		}
	}
	return map[string]any{
		"client":   c.Name,
		"memories": out,
		"note":     "Only advisor-confirmed, unexpired memories this user may read. similarity ranks results; it is not confidence.",
	}, clientID, nil
}

func (s *Server) voyageEmbed(ctx context.Context, text string) ([]float64, error) {
	reqBody, _ := json.Marshal(map[string]any{"input": []string{text}, "model": s.cfg.EmbeddingModel, "input_type": "query", "output_dimension": s.cfg.EmbeddingDims})
	req, _ := http.NewRequestWithContext(ctx, "POST", strings.TrimRight(s.cfg.VoyageBaseURL, "/")+"/embeddings", bytes.NewReader(reqBody))
	req.Header.Set("Authorization", "Bearer "+s.cfg.VoyageKey)
	req.Header.Set("Content-Type", "application/json")
	res, err := s.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return nil, fmt.Errorf("embeddings request failed: %s", res.Status)
	}
	var out struct {
		Data []struct {
			Embedding []float64 `json:"embedding"`
		} `json:"data"`
	}
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil || len(out.Data) == 0 {
		return nil, fmt.Errorf("embeddings response unreadable")
	}
	if len(out.Data[0].Embedding) != s.cfg.EmbeddingDims {
		return nil, fmt.Errorf("embedding dimension mismatch: got %d", len(out.Data[0].Embedding))
	}
	return out.Data[0].Embedding, nil
}

// ---------- prepare_follow_ups ----------

// prepareFollowUps runs the full governed agent (retrieval, lender-policy engine, planner, validation)
// in the Recall.IQ app, as this user, and returns a voice-sized summary.
func (s *Server) prepareFollowUps(ctx context.Context, u *User, body map[string]any) (any, string, error) {
	clientID := str(body, "client_id")
	request := str(body, "request")
	if clientID == "" || len(request) < 3 {
		return nil, clientID, &apiError{400, "client_id and request are required."}
	}
	if _, err := authorizeClient(ctx, s.db, u, clientID); err != nil {
		return nil, clientID, err
	}
	if s.cfg.InternalSecret == "" {
		return nil, clientID, &apiError{503, "INTERNAL_API_SECRET is not configured."}
	}
	payload, _ := json.Marshal(map[string]string{"userId": u.ID, "clientId": clientID, "request": request})
	req, _ := http.NewRequestWithContext(ctx, "POST", strings.TrimRight(s.cfg.ContinuityURL, "/")+"/api/internal/agent/run", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Internal-Secret", s.cfg.InternalSecret)
	res, err := s.http.Do(req)
	if err != nil {
		return nil, clientID, err
	}
	defer res.Body.Close()
	var out map[string]any
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		return nil, clientID, fmt.Errorf("continuity run response unreadable")
	}
	if res.StatusCode != 200 {
		msg, _ := out["error"].(string)
		return nil, clientID, &apiError{res.StatusCode, msg}
	}
	return out, clientID, nil
}

// ---------- propose_memory ----------

var nonAlnum = regexp.MustCompile(`[^a-z0-9]+`)

func normalize(s string) string {
	return strings.TrimSpace(nonAlnum.ReplaceAllString(strings.ToLower(s), " "))
}

func sha32(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])[:32]
}

// memoryFingerprint matches src/lib/util.ts, so tombstones of forgotten memories block re-creation by voice too.
func memoryFingerprint(clientID, statement string) string {
	return sha32("stmt|" + clientID + "|" + normalize(statement))
}

var allowedCategories = map[string]bool{
	"goal": true, "constraint": true, "previous_decision": true, "revisit_condition": true,
	"preference": true, "advisor_commitment": true, "life_event": true,
}

var noExpiry = time.Date(9999, 12, 31, 0, 0, 0, 0, time.UTC)

func (s *Server) proposeMemory(ctx context.Context, u *User, body map[string]any) (any, string, error) {
	clientID := str(body, "client_id")
	statement := str(body, "statement")
	category := str(body, "category")
	spoken := str(body, "spoken_note")
	if clientID == "" || len(statement) < 5 || len(spoken) < 5 {
		return nil, clientID, &apiError{400, "client_id, statement and spoken_note are required."}
	}
	if len(statement) > 400 || len(spoken) > 2000 {
		return nil, clientID, &apiError{400, "statement or spoken_note is too long."}
	}
	if !allowedCategories[category] {
		return nil, clientID, &apiError{400, "category must be one of goal, constraint, previous_decision, revisit_condition, preference, advisor_commitment, life_event."}
	}
	if _, err := authorizeClient(ctx, s.db, u, clientID); err != nil {
		return nil, clientID, err
	}
	fp := memoryFingerprint(clientID, statement)
	if n, _ := s.db.Collection("forget_tombstones").CountDocuments(ctx, bson.M{"firmId": u.FirmID, "clientId": clientID, "fingerprints": fp}); n > 0 {
		return map[string]any{"proposed": false, "reason": "This was forgotten earlier and cannot be re-created."}, clientID, nil
	}
	if n, _ := s.db.Collection("memories").CountDocuments(ctx, bson.M{"firmId": u.FirmID, "clientId": clientID, "fingerprint": fp, "status": bson.M{"$in": bson.A{"active", "proposed"}}}); n > 0 {
		return map[string]any{"proposed": false, "reason": "Already recorded."}, clientID, nil
	}
	now := s.clock().UTC()
	at := now.Format(time.RFC3339Nano)
	srcID := newID("src")
	// The spoken note is the evidence; it is stored verbatim and never treated as an instruction.
	src := bson.M{
		"_id": srcID, "firmId": u.FirmID, "clientId": clientID, "kind": "advisor_note", "title": "Voice note",
		"text": spoken, "sourceDate": now.Format("2006-01-02"), "createdBy": u.ID, "createdAt": at,
		"contentHash": sha32(spoken), "safetyFlags": bson.A{},
	}
	if _, err := s.db.Collection("sources").InsertOne(ctx, src); err != nil {
		return nil, clientID, err
	}
	memID := newID("mem")
	mem := bson.M{
		"_id": memID, "lineageId": newID("lin"), "version": 1, "firmId": u.FirmID, "clientId": clientID,
		"category": category, "statement": statement,
		"structured": bson.M{"topic": topicFor(statement), "attributes": bson.M{}},
		"status":     "proposed", "basis": "source_supported",
		"evidence":  bson.A{bson.M{"sourceId": srcID, "excerpt": spoken, "sourceDate": now.Format("2006-01-02"), "sourceKind": "advisor_note"}},
		"proposal":  bson.M{"kind": "new", "extractor": "elevenlabs-voice", "proposedBy": u.ID, "proposedAt": at},
		"createdAt": at, "createdBy": u.ID, "visibility": "team", "allowedUserIds": bson.A{},
		"expiresAt": nil, "reviewAt": nil, "retrievalExpiresAt": noExpiry, "fingerprint": fp,
	}
	if _, err := s.db.Collection("memories").InsertOne(ctx, mem); err != nil {
		return nil, clientID, err
	}
	return map[string]any{
		"proposed": true,
		"memoryId": memID,
		"note":     "Saved as a proposal. It will not be used by the agent until an advisor confirms it on the Memory page.",
	}, clientID, nil
}

func topicFor(statement string) string {
	t := strings.ReplaceAll(normalize(statement), " ", "_")
	if len(t) > 40 {
		t = strings.TrimRight(t[:40], "_")
	}
	return t
}
