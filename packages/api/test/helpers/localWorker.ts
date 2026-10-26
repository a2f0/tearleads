import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { resolve } from "node:path";
import { getDefaultApiDatabaseKind } from "@tearleads/api-shared/postgres";
import {
  authChallengeSigningBytes,
  sign,
  toFingerprint,
} from "@tearleads/crypto";
import type { TestUser } from "@tearleads/test-utils";

/**
 * Runs the deployed Worker entry in workerd through `wrangler dev`: the real
 * `wrangler.jsonc` (aliases, Loro WASM, SQLite Durable Objects), the Workers
 * Postgres socket against the lane's database, and request-scoped pools.
 * Wrangler's programmatic API does not serve requests under Bun, so the dev
 * server runs as a child process. The Worker and the test share the lane
 * database, so in-process fixtures (registration, signed mutations) are
 * visible to it.
 */
export const databaseKind = getDefaultApiDatabaseKind();
export const BUILD_VERSION = 424242;
// The Worker runs with NODE_ENV=production, which requires an https public
// origin; login challenges are bound to it rather than to the Host header.
const PUBLIC_ORIGIN = "https://api.workerd.test";
export const START_TIMEOUT_MS = 150_000;
const apiDir = resolve(import.meta.dir, "../..");

export interface LocalWorker {
  readonly origin: string;
  readonly stop: () => Promise<void>;
  readonly logs: () => string;
}

const databaseUrlKey = "DATABASE_URL";
const postgresUrlKey = "POSTGRES_URL";
const pgUserKey = "PGUSER";
const postgresPartKeys = [
  "POSTGRES_HOST",
  "POSTGRES_PORT",
  "POSTGRES_USER",
  "POSTGRES_PASSWORD",
  "POSTGRES_DATABASE",
] as const;

export function databaseVars(): Record<string, string> {
  const url = process.env[databaseUrlKey] ?? process.env[postgresUrlKey];
  const vars = new Map<string, string>();
  if (url) {
    const parsed = new URL(url);
    vars.set(
      "POSTGRES_HOST",
      parsed.hostname === "localhost" ? "127.0.0.1" : parsed.hostname,
    );
    vars.set("POSTGRES_PORT", parsed.port || "5432");
    // pg defaults to the OS user in Node; workerd has none to fall back to.
    vars.set(
      "POSTGRES_USER",
      decodeURIComponent(parsed.username) ||
        process.env[pgUserKey] ||
        userInfo().username,
    );
    // Production settings require a password; a trust-authenticated local
    // server ignores whatever is sent.
    vars.set(
      "POSTGRES_PASSWORD",
      decodeURIComponent(parsed.password) || "trust-authentication",
    );
    vars.set("POSTGRES_DATABASE", parsed.pathname.replace(/^\//, ""));
  } else {
    for (const key of postgresPartKeys) {
      const value = process.env[key];
      if (value !== undefined) {
        vars.set(key, value);
      }
    }
  }
  return Object.fromEntries(vars);
}

async function freePort(): Promise<number> {
  const server = Bun.serve({ port: 0, fetch: () => new Response() });
  const { port } = server;
  await server.stop(true);
  if (port === undefined) {
    throw new Error("Could not reserve a local port");
  }
  return port;
}

export async function startLocalWorker(
  overrides: Readonly<Record<string, string>> = {},
): Promise<LocalWorker> {
  const [port, inspectorPort] = await Promise.all([freePort(), freePort()]);
  const persist = await mkdtemp(resolve(tmpdir(), "tearleads-worker-state-"));
  const child = Bun.spawn(
    [
      "bunx",
      "--no-install",
      "wrangler",
      "dev",
      "--env",
      "local",
      "--port",
      String(port),
      "--inspector-port",
      String(inspectorPort),
      "--persist-to",
      persist,
      "--log-level",
      "log",
      "--test-scheduled",
      ...Object.entries({
        ...databaseVars(),
        POSTGRES_SSL: "false",
        POSTGRES_SSL_REJECT_UNAUTHORIZED: "false",
        API_PUBLIC_ORIGIN: PUBLIC_ORIGIN,
        API_CORS_ORIGINS: "*",
        API_BILLING_RETURN_ORIGINS: "https://app.workerd.test",
        DOCUMENT_SYNC_CURSOR_HMAC_KEY: "workerd-cursor-key-".repeat(3),
        ...overrides,
      }).flatMap(([key, value]) => ["--var", `${key}:${value}`]),
      "--define",
      `API_BUILD_VERSION:${BUILD_VERSION}`,
      "--define",
      `API_DIAGNOSTICS_BUILD:${JSON.stringify({ commit: "workerd-test" })}`,
    ],
    {
      cwd: apiDir,
      env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "true" },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  let output = "";
  const collect = async (stream: ReadableStream<Uint8Array>) => {
    for await (const chunk of stream) {
      output += new TextDecoder().decode(chunk);
    }
  };
  void collect(child.stdout);
  void collect(child.stderr);
  const origin = `http://127.0.0.1:${port}`;
  const stop = async () => {
    child.kill();
    await child.exited;
    await rm(persist, { recursive: true, force: true });
  };
  // Neither an early exit nor a timeout hands back a handle: the child is
  // stopped, its state removed, and the failure quotes the bounded output.
  const fail = async (reason: string): Promise<never> => {
    await stop();
    throw new Error(`${reason}\nwrangler dev output:\n${output.slice(-6000)}`);
  };
  const deadline = Date.now() + START_TIMEOUT_MS;
  let ready = false;
  while (!ready && Date.now() < deadline) {
    if (child.exitCode !== null) {
      return fail(`wrangler dev exited early with code ${child.exitCode}`);
    }
    try {
      const response = await fetch(`${origin}/`, {
        signal: AbortSignal.timeout(5_000),
      });
      ready = response.status === 200;
    } catch {
      // Not listening yet.
    }
    if (!ready) {
      await Bun.sleep(500);
    }
  }
  if (!ready) {
    return fail(`wrangler dev was not ready within ${START_TIMEOUT_MS} ms`);
  }
  return { origin, logs: () => output, stop };
}

let workerLogs: () => string = () => "";

/** Lets failure messages quote the dev server's output. */
export function attachWorkerLogs(logs: () => string): void {
  workerLogs = logs;
}

export async function expectJson(
  response: Response,
  status: number,
): Promise<Record<string, unknown>> {
  const body = await response.text();
  if (response.status !== status) {
    // The dev server relays the Worker's console output a moment later.
    await Bun.sleep(1_500);
    throw new Error(
      `Expected ${status}, got ${response.status} ${body.slice(0, 200)}\nWorker output:\n${workerLogs().slice(-4000)}`,
    );
  }
  return body ? JSON.parse(body) : {};
}

/** Reads one field of a parsed frame or body. */
export function field(record: Record<string, unknown>, key: string): unknown {
  return record[key];
}

export function stringField(
  body: Record<string, unknown>,
  key: string,
): string {
  const value = body[key];
  if (typeof value !== "string") {
    throw new Error(`Expected a string ${key} in ${JSON.stringify(body)}`);
  }
  return value;
}

export function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

export interface OpenSocket {
  readonly socket: WebSocket;
  /** Settles when the server closes the socket. */
  readonly closed: Promise<{ readonly code: number; readonly reason: string }>;
}

export async function openSocket(url: string): Promise<OpenSocket> {
  const socket = new WebSocket(url);
  const closed = new Promise<{ code: number; reason: string }>((resolve) => {
    socket.addEventListener("close", (event) =>
      resolve({ code: event.code, reason: event.reason }),
    );
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("WebSocket open timed out")),
      15_000,
    );
    socket.addEventListener("open", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("WebSocket failed to open"));
    });
  });
  return { socket, closed };
}

/** Logs a registered user in through the Worker and returns its bearer token. */
export async function loginThroughWorker(
  origin: string,
  user: TestUser,
): Promise<string> {
  const fingerprint = await toFingerprint(user.signing.signingPublicKey);
  const challenge = await expectJson(
    await postJson(`${origin}/auth/challenge`, { fingerprint }),
    200,
  );
  const signature = sign(
    authChallengeSigningBytes({
      apiOrigin: PUBLIC_ORIGIN,
      challengeHex: stringField(challenge, "challenge"),
      fingerprint,
    }),
    user.signing.signingPrivateKey,
  );
  const verified = await expectJson(
    await postJson(`${origin}/auth/verify`, {
      fingerprint,
      signature: Array.from(signature),
    }),
    200,
  );
  return stringField(verified, "token");
}

/** Opens a realtime socket for the session and collects what the hub sends. */
export async function openRealtimeSocket(
  origin: string,
  token: string,
): Promise<OpenSocket & { readonly frames: () => readonly unknown[] }> {
  const ticket = await expectJson(
    await fetch(`${origin}/auth/ws-ticket`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    }),
    200,
  );
  const url = `${origin.replace(/^http/, "ws")}/events?ticket=${stringField(ticket, "ticket")}`;
  const opened = await openSocket(url);
  const frames: unknown[] = [];
  opened.socket.addEventListener("message", (event) => {
    frames.push(JSON.parse(String(event.data)));
  });
  return { ...opened, frames: () => frames };
}

/** Resolves with the first frame matching `predicate`, or fails after 10 s. */
export async function waitForFrame(
  frames: () => readonly unknown[],
  predicate: (frame: Record<string, unknown>) => boolean,
  description: string,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 10_000;
  let seen = 0;
  while (Date.now() < deadline) {
    const current = frames();
    for (; seen < current.length; seen++) {
      const frame = current[seen];
      if (typeof frame === "object" && frame !== null) {
        const record: Record<string, unknown> = { ...frame };
        if (predicate(record)) {
          return record;
        }
      }
    }
    await Bun.sleep(50);
  }
  throw new Error(
    `No ${description} frame arrived; received ${JSON.stringify(frames())}`,
  );
}
