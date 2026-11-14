import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Short-lived session tokens for the ElevenLabs voice agent. The app signs one for the logged-in
 * user; the agent passes it to the Go tool service as a dynamic variable, and the Go service
 * verifies it (agent-tools/auth.go). The LLM never chooses who the user is.
 * Format: base64url(json{uid,exp}) + "." + hex(hmac_sha256(secret, payload)).
 */
export function signVoiceToken(secret: string, uid: string, ttlSeconds = 1800, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ uid, exp: Math.floor(now / 1000) + ttlSeconds })).toString("base64url");
  const sig = createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

export function verifyVoiceToken(secret: string, token: string, now = Date.now()): string | null {
  const [payload, sig] = token.trim().split(".");
  if (!payload || !sig) return null;
  const want = createHmac("sha256", secret).update(payload).digest("hex");
  if (want.length !== sig.length || !timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null;
  try {
    const c = JSON.parse(Buffer.from(payload, "base64url").toString()) as { uid?: string; exp?: number };
    if (!c.uid || !c.exp || Math.floor(now / 1000) > c.exp) return null;
    return c.uid;
  } catch {
    return null;
  }
}
