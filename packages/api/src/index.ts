import { get } from "./adapters/redis";
import { routeApp } from "./routeApp";
import type { SessionData } from "./validators/session";
import { isSessionData } from "./validators/session";
import { websocket } from "./ws";

const SESSION_PREFIX = "session:";

function extractToken(req: Request): string | null {
  const header = req.headers.get("Authorization");
  if (!header?.startsWith("Bearer ")) {
    return null;
  }
  return header.slice(7);
}

async function resolveSession(token: string): Promise<SessionData | null> {
  const sessionRaw = await get(`${SESSION_PREFIX}${token}`);
  if (!sessionRaw) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(sessionRaw);
  } catch {
    return null;
  }

  if (!isSessionData(parsed)) {
    return null;
  }

  return parsed;
}

const server = {
  port: 3001,
  async fetch(
    req: Request,
    server: { upgrade(req: Request, options?: { data?: unknown }): boolean },
  ) {
    if (req.headers.get("upgrade") === "websocket") {
      const token = extractToken(req);
      if (!token) {
        return new Response("Unauthorized", { status: 401 });
      }

      const session = await resolveSession(token);
      if (!session) {
        return new Response("Unauthorized", { status: 401 });
      }

      if (server.upgrade(req, { data: session })) return undefined;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }
    return routeApp.fetch(req);
  },
  websocket,
};
export default server;
