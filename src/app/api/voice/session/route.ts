import { handle } from "@/lib/api";
import { AppError } from "@/lib/auth";
import { signVoiceToken } from "@/lib/voice-token";
export const dynamic = "force-dynamic";

/** Mints a 30-minute voice session token for the current persona, plus the ElevenLabs agent id. */
export async function GET() {
  return handle(async (ctx) => {
    const secret = process.env.VOICE_TOKEN_SECRET;
    const agentId = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID ?? process.env.ELEVENLABS_AGENT_ID;
    if (!secret || !agentId) {
      throw new AppError(503, "voice_not_configured", "Voice is not configured. Set VOICE_TOKEN_SECRET and ELEVENLABS_AGENT_ID.");
    }
    return { token: signVoiceToken(secret, ctx.userId), agentId, user: ctx.user.name, expiresInSeconds: 1800 };
  });
}
