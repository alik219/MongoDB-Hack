package main

import (
	"testing"
	"time"
)

func TestTokenRoundTripAndTamper(t *testing.T) {
	now := time.Date(2026, 11, 14, 12, 0, 0, 0, time.UTC)
	tok := signToken("s3cret", "usr_tomas", 30*time.Minute, now)
	uid, err := verifyToken("s3cret", tok, now.Add(time.Minute))
	if err != nil || uid != "usr_tomas" {
		t.Fatalf("valid token rejected: %v %q", err, uid)
	}
	if _, err := verifyToken("other", tok, now); err == nil {
		t.Fatal("token accepted with the wrong secret")
	}
	if _, err := verifyToken("s3cret", tok, now.Add(31*time.Minute)); err == nil {
		t.Fatal("expired token accepted")
	}
	forged := signToken("s3cret", "usr_riya", time.Minute, now)
	if _, err := verifyToken("s3cret", forged[:len(forged)-1]+"0", now); err == nil {
		t.Fatal("tampered signature accepted")
	}
}

// The voice tool must compute the same fingerprint as the TypeScript app, or a forgotten
// memory's tombstone would not block it from being re-created by voice.
func TestFingerprintMatchesTypeScript(t *testing.T) {
	// npx tsx -e 'import {memoryFingerprint} from "./src/lib/util"; console.log(memoryFingerprint("cli_c3_priya","Priya wants to retire at 50!"))'
	if got := memoryFingerprint("cli_c3_priya", "Priya wants to retire at 50!"); got != "3625db957725b6b8804fd531cb543c13" {
		t.Fatalf("fingerprint mismatch: %s", got)
	}
}

func TestEligibilityRecheck(t *testing.T) {
	u := &User{ID: "usr_tomas", FirmID: "frm_lakeshore"}
	now := time.Date(2026, 11, 14, 0, 0, 0, 0, time.UTC)
	past := "2026-07-01T00:00:00.000Z"
	base := memoryHit{FirmID: "frm_lakeshore", ClientID: "cli_c3_priya", Status: "active", Visibility: "team"}
	if !eligible(base, u, "cli_c3_priya", now) {
		t.Fatal("team memory should be eligible")
	}
	cases := map[string]memoryHit{
		"other client": {FirmID: "frm_lakeshore", ClientID: "cli_c1_maya", Status: "active", Visibility: "team"},
		"other firm":   {FirmID: "frm_northlight", ClientID: "cli_c3_priya", Status: "active", Visibility: "team"},
		"proposed":     {FirmID: "frm_lakeshore", ClientID: "cli_c3_priya", Status: "proposed", Visibility: "team"},
		"expired":      {FirmID: "frm_lakeshore", ClientID: "cli_c3_priya", Status: "active", Visibility: "team", ExpiresAt: &past},
		"restricted":   {FirmID: "frm_lakeshore", ClientID: "cli_c3_priya", Status: "active", Visibility: "restricted", Allowed: []string{"usr_riya"}},
	}
	for name, m := range cases {
		if eligible(m, u, "cli_c3_priya", now) {
			t.Errorf("%s memory should not be eligible", name)
		}
	}
}

func TestTopicFor(t *testing.T) {
	if got := topicFor("Priya wants to retire at 50, and sell the business around then!"); len(got) > 40 || got == "" {
		t.Fatalf("bad topic %q", got)
	}
}

// A token minted by the Next.js app (src/lib/voice-token.ts) must verify here, byte for byte.
func TestTokenParityWithTypeScript(t *testing.T) {
	now := time.Date(2026, 11, 14, 12, 0, 0, 0, time.UTC)
	fromTS := "eyJ1aWQiOiJ1c3JfdG9tYXMiLCJleHAiOjE3OTQ2NTk0MDB9.36b5593ca7428c790afd4327d5d7f8831ecc0b6c71992bc85ed79d064e08cbc3"
	if uid, err := verifyToken("s3cret", fromTS, now); err != nil || uid != "usr_tomas" {
		t.Fatalf("TS token rejected: %v", err)
	}
	if got := signToken("s3cret", "usr_tomas", 30*time.Minute, now); got != fromTS {
		t.Fatalf("Go token differs from TS token:\n%s\n%s", got, fromTS)
	}
}
