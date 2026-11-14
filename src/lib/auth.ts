import { cookies } from "next/headers";
import { getStore } from "./store";
import type { Client, User } from "./types";

/**
 * DEMO AUTHENTICATION. A persona cookie selects one of the server-defined users.
 * Firm, role and client assignments are always loaded from the database record,
 * never from anything the browser sends. This is not production authentication.
 */
export const PERSONA_COOKIE = "continuity_persona";
/** Opens on the hackathon firm (Tomás Reyes, Priya's advisor); falls back to the sample firm if that data is not seeded. */
export const DEFAULT_PERSONA = process.env.DEFAULT_PERSONA ?? "usr_tomas";
const FALLBACK_PERSONA = "usr_maya";

export interface AuthContext {
  user: User;
  userId: string;
  firmId: string;
  role: User["role"];
}

export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export const denied = (msg: string) => new AppError(403, "permission_denied", msg);
export const notFound = (msg = "Not found") => new AppError(404, "not_found", msg);
export const badRequest = (msg: string) => new AppError(400, "bad_request", msg);
export const conflict = (msg: string) => new AppError(409, "conflict", msg);

export async function contextForUser(userId: string): Promise<AuthContext> {
  const store = await getStore();
  const user = await store.users.findOne({ _id: userId });
  if (!user) throw new AppError(401, "unauthenticated", "Unknown persona");
  return { user, userId: user._id, firmId: user.firmId, role: user.role };
}

export async function getAuthContext(): Promise<AuthContext> {
  const jar = await cookies();
  const id = jar.get(PERSONA_COOKIE)?.value ?? DEFAULT_PERSONA;
  try {
    return await contextForUser(id);
  } catch {
    try {
      return await contextForUser(DEFAULT_PERSONA);
    } catch {
      return contextForUser(FALLBACK_PERSONA);
    }
  }
}

/**
 * Validates that the client exists, belongs to the caller's firm, and that the caller is
 * assigned to it. Cross-firm lookups return "not found" so they do not reveal existence.
 */
export async function authorizeClient(ctx: AuthContext, clientId: string): Promise<Client> {
  if (typeof clientId !== "string" || !clientId) throw badRequest("clientId is required");
  const store = await getStore();
  const client = await store.clients.findOne({ _id: clientId, firmId: ctx.firmId });
  if (!client) throw notFound("Client not found");
  if (!ctx.user.clientIds.includes(client._id) || !client.teamUserIds.includes(ctx.userId)) {
    throw denied("You are not assigned to this client.");
  }
  return client;
}

export function isLeadAdvisor(ctx: AuthContext, client: Client) {
  return ctx.role === "lead_advisor" && client.leadAdvisorId === ctx.userId;
}

export function requireLeadAdvisor(ctx: AuthContext, client: Client, action: string) {
  if (!isLeadAdvisor(ctx, client)) {
    throw denied(`Only ${client.name}'s lead advisor can ${action}.`);
  }
}
