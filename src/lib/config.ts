/**
 * Runtime configuration. Each service independently resolves to a LIVE provider
 * (when credentials exist) or an explicitly labeled DEMO implementation.
 */
/**
 * atlas-auto: Atlas Vector Search auto-embedding. Memories store `embeddingText`; Atlas generates and
 * manages the Voyage vectors at index time and embeds the query text itself. No embedding key in the app.
 */
export type EmbeddingProvider = "voyage" | "openai" | "atlas-auto" | "demo";
export type PlannerProvider = "openai" | "anthropic" | "demo";

function embeddingConfig() {
  const explicit = process.env.EMBEDDING_PROVIDER as EmbeddingProvider | undefined;
  const provider: EmbeddingProvider =
    explicit ??
    // OPENAI_API_KEY alone does not select OpenAI embeddings (it powers the planner); set EMBEDDING_PROVIDER=openai for that.
    (process.env.VOYAGE_API_KEY ? "voyage" : process.env.MONGODB_URI ? "atlas-auto" : "demo");
  const defaults: Record<EmbeddingProvider, { model: string; dims: number }> = {
    voyage: { model: "voyage-4-lite", dims: 1024 },
    "atlas-auto": { model: "voyage-4-lite", dims: 1024 },
    openai: { model: "text-embedding-3-small", dims: 1536 },
    demo: { model: "demo-hash-v1", dims: 256 },
  };
  const model = process.env.EMBEDDING_MODEL ?? defaults[provider].model;
  const dims = Number(process.env.EMBEDDING_DIMENSIONS ?? defaults[provider].dims);
  return {
    provider,
    model,
    dims,
    /** Stored on every embedded memory and required by the retrieval filter, so models never mix. */
    id: `${provider}:${model}:${dims}`,
    live: provider !== "demo",
  };
}

function plannerConfig() {
  const provider: PlannerProvider =
    (process.env.PLANNER_PROVIDER as PlannerProvider | undefined) ??
    (process.env.OPENAI_API_KEY ? "openai" : process.env.ANTHROPIC_API_KEY ? "anthropic" : "demo");
  const model =
    provider === "openai"
      ? (process.env.OPENAI_MODEL ?? "gpt-4.1")
      : provider === "anthropic"
        ? (process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5")
        : "demo-rules-v1";
  return {
    provider,
    model,
    effort: (process.env.ANTHROPIC_EFFORT ?? "medium") as "low" | "medium" | "high",
    live: provider !== "demo",
  };
}

export function getConfig() {
  const embedding = embeddingConfig();
  const planner = plannerConfig();
  const mongoUri = process.env.MONGODB_URI;
  return {
    storage: {
      kind: (mongoUri ? "atlas" : "demo") as "atlas" | "demo",
      uri: mongoUri,
      dbName: process.env.MONGODB_DB ?? "continuity",
    },
    embedding,
    planner,
    allowDemoReset: process.env.ALLOW_DEMO_RESET === "true" || !mongoUri,
  };
}

export type AppConfig = ReturnType<typeof getConfig>;

export function serviceLabels(cfg: AppConfig = getConfig()) {
  return {
    storage: cfg.storage.kind === "atlas" ? "MongoDB Atlas" : "Demo store (in-process)",
    vectorSearch:
      cfg.storage.kind === "atlas" ? "Atlas Vector Search ($vectorSearch)" : "Demo cosine search (in-app, not Atlas)",
    embeddings: cfg.embedding.provider === "atlas-auto"
      ? `Atlas auto-embedding · ${cfg.embedding.model}`
      : cfg.embedding.live
      ? `${cfg.embedding.provider} · ${cfg.embedding.model} (${cfg.embedding.dims}d)`
      : `Demo hashed embeddings (${cfg.embedding.dims}d, not a semantic model)`,
    planner: cfg.planner.live
      ? `${cfg.planner.provider === "openai" ? "OpenAI" : "Anthropic"} · ${cfg.planner.model}`
      : "Demo rule-based planner & extractor (deterministic, no model)",
  };
}
