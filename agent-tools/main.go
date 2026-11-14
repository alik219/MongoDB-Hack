// Command agent-tools is the Go tool service behind the Recall.IQ voice agent.
//
// An ElevenLabs Conversational AI agent handles speech and reasoning (its LLM can be an
// OpenAI model). Whenever it needs client memory it calls these webhook tools. Every tool:
//   - derives identity from a signed session token minted by the Recall.IQ app (never from the LLM),
//   - authorizes the client against the users/clients collections in MongoDB Atlas,
//   - applies the same firm/client/status/expiry/access pre-filter inside $vectorSearch,
//   - writes an audit event.
//
// Proposed memories are stored as "proposed": an advisor must confirm them in the dashboard
// before any run can use them.
package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

type Config struct {
	MongoURI          string
	DBName            string
	VectorIndex       string
	TokenSecret       string
	ToolsSharedSecret string
	ContinuityURL     string
	InternalSecret    string
	EmbeddingProvider string // "atlas-auto" | "voyage"
	EmbeddingModel    string
	EmbeddingDims     int
	VoyageKey         string
	VoyageBaseURL     string
	Port              string
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func loadConfig() Config {
	c := Config{
		MongoURI:          os.Getenv("MONGODB_URI"),
		DBName:            env("MONGODB_DB", "continuity"),
		VectorIndex:       env("ATLAS_VECTOR_INDEX", "memory_vector_index"),
		TokenSecret:       os.Getenv("VOICE_TOKEN_SECRET"),
		ToolsSharedSecret: os.Getenv("TOOLS_SHARED_SECRET"),
		ContinuityURL:     env("CONTINUITY_URL", "http://localhost:3000"),
		InternalSecret:    os.Getenv("INTERNAL_API_SECRET"),
		EmbeddingModel:    env("EMBEDDING_MODEL", "voyage-4-lite"),
		EmbeddingDims:     1024,
		VoyageKey:         os.Getenv("VOYAGE_API_KEY"),
		VoyageBaseURL:     env("VOYAGE_BASE_URL", "https://ai.mongodb.com/v1"),
		Port:              env("PORT", "8080"),
	}
	// Must resolve exactly like the Next.js app (src/lib/config.ts) so embeddingModel ids match.
	c.EmbeddingProvider = os.Getenv("EMBEDDING_PROVIDER")
	if c.EmbeddingProvider == "" {
		if c.VoyageKey != "" {
			c.EmbeddingProvider = "voyage"
		} else {
			c.EmbeddingProvider = "atlas-auto"
		}
	}
	return c
}

func main() {
	cfg := loadConfig()
	// Local testing only: print a session token for a user id (the app mints these in production).
	if len(os.Args) == 3 && os.Args[1] == "-mint" {
		if cfg.TokenSecret == "" {
			log.Fatal("VOICE_TOKEN_SECRET is required")
		}
		fmt.Println(signToken(cfg.TokenSecret, os.Args[2], 30*time.Minute, time.Now()))
		return
	}
	if cfg.MongoURI == "" || cfg.TokenSecret == "" {
		log.Fatal("MONGODB_URI and VOICE_TOKEN_SECRET are required")
	}
	if cfg.EmbeddingProvider != "atlas-auto" && cfg.EmbeddingProvider != "voyage" {
		log.Fatalf("EMBEDDING_PROVIDER %q is not supported by the Go service (use atlas-auto or voyage)", cfg.EmbeddingProvider)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	client, err := mongo.Connect(options.Client().ApplyURI(cfg.MongoURI).SetAppName("continuity-agent-tools"))
	if err != nil {
		log.Fatal(err)
	}
	if err := client.Ping(ctx, nil); err != nil {
		log.Fatalf("cannot reach Atlas: %v", err)
	}
	s := &Server{cfg: cfg, db: client.Database(cfg.DBName), http: &http.Client{Timeout: 120 * time.Second}}
	log.Printf("agent-tools listening on :%s (db=%s, embeddings=%s)", cfg.Port, cfg.DBName, s.embeddingID())
	log.Fatal(http.ListenAndServe(":"+cfg.Port, s.routes()))
}
