import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { resolve } from "node:path";
import { getDefaultApiDatabaseKind } from "@tearleads/api-shared/postgres";
import { createTestUser } from "@tearleads/bob-and-alice";
import {
  authChallengeSigningBytes,
  sign,
  toFingerprint,
} from "@tearleads/crypto";
import { createRegistrationRequestBody } from "../../test/helpers/api/submitRegistration";

/**
 * Runs the deployed entry in workerd through `wrangler dev`: the real
 * `wrangler.jsonc` (aliases, Loro WASM, SQLite Durable Objects), the Workers
 * Postgres socket against the lane's database, request-scoped pools, the
 * realtime hub's ticket consumption, and Cron dispatch. Bun tests cover the
 * pieces; this covers the seams between them that only exist in the runtime.
 * Wrangler's programmatic API does not serve requests under Bun, so the dev
 * server runs as a child process.
 */
const databaseKind = getDefaultApiDatabaseKind();
const BUILD_VERSION = 424242;
const START_TIMEOUT_MS = 150_000;
const apiDir = resolve(import.meta.dir, "../..");

interface LocalWorker {
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

function databaseVars(): string[] {
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
    vars.set("POSTGRES_PASSWORD", decodeURIComponent(parsed.password));
    vars.set("POSTGRES_DATABASE", parsed.pathname.replace(/^\//, ""));
  } else {
    for (const key of postgresPartKeys) {
      const value = process.env[key];
      if (value !== undefined) {
        vars.set(key, value);
      }
    }
  }
  return [...vars].flatMap(([key, value]) => ["--var", `${key}:${value}`]);
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

async function startLocalWorker(): Promise<LocalWorker> {
  const [port, inspectorPort] = await Promise.all([freePort(), freePort()]);
  const persist = await mkdtemp(resolve(tmpdir(), "tearleads-worker-state-"));
  const child = Bun.spawn(
    [
      "bunx",
      "--no-install",
      "wrangler",
      "dev",
      "--env",
      "staging",
      "--port",
      String(port),
      "--inspector-port",
      String(inspectorPort),
      "--persist-to",
      persist,
      "--log-level",
      "log",
      "--test-scheduled",
      ...databaseVars(),
      "--var",
      "POSTGRES_SSL:false",
      "--var",
      "POSTGRES_SSL_REJECT_UNAUTHORIZED:false",
      "--var",
      "API_CORS_ORIGINS:http://app.localhost",
      "--var",
      `DOCUMENT_SYNC_CURSOR_HMAC_KEY:${"workerd-cursor-key-".repeat(3)}`,
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
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`wrangler dev exited early:\n${output}`);
    }
    try {
      const response = await fetch(`${origin}/`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (response.status === 200) {
        break;
      }
    } catch {
      // Not listening yet.
    }
    await Bun.sleep(500);
  }
  return {
    origin,
    logs: () => output,
    stop: async () => {
      child.kill();
      await child.exited;
      await rm(persist, { recursive: true, force: true });
    },
  };
}

let workerLogs: () => string = () => "";

async function expectJson(
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

function stringField(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string") {
    throw new Error(`Expected a string ${key} in ${JSON.stringify(body)}`);
  }
  return value;
}

function postJson(
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

async function openSocket(url: string): Promise<{ readonly code: number }> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timer = setTimeout(
      () => reject(new Error("WebSocket open timed out")),
      15_000,
    );
    socket.addEventListener("open", () => socket.close(1000, "done"));
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("WebSocket failed to open"));
    });
    socket.addEventListener("close", (event) => {
      clearTimeout(timer);
      resolve({ code: event.code });
    });
  });
}

describe.skipIf(databaseKind !== "postgres")("Worker runtime", () => {
  let worker: LocalWorker;

  beforeAll(async () => {
    worker = await startLocalWorker();
    workerLogs = worker.logs;
  }, START_TIMEOUT_MS + 10_000);

  afterAll(async () => {
    await worker?.stop();
  });

  test("serves the deployed entry with its build version", async () => {
    const health = await fetch(`${worker.origin}/`);
    expect(await expectJson(health, 200)).toEqual({
      message: "ok",
    });
    expect(health.headers.get("x-tearleads-api-version")).toBe(
      String(BUILD_VERSION),
    );
  });

  test("registers, logs in, serves concurrent reads, opens one socket per ticket, and logs out", async () => {
    const base = worker.origin;
    const user = createTestUser();
    const fingerprint = await toFingerprint(user.signing.signingPublicKey);
    await expectJson(
      await postJson(
        `${base}/auth/register`,
        await createRegistrationRequestBody(
          user.signing.signingPublicKey,
          user.signing.signingPrivateKey,
          user.kem.publicKey,
          { includeTrashSystemContainer: true },
        ),
      ),
      200,
    );

    const challenge = await expectJson(
      await postJson(`${base}/auth/challenge`, { fingerprint }),
      200,
    );
    const signature = sign(
      authChallengeSigningBytes({
        apiOrigin: base,
        challengeHex: stringField(challenge, "challenge"),
        fingerprint,
      }),
      user.signing.signingPrivateKey,
    );
    const verified = await expectJson(
      await postJson(`${base}/auth/verify`, {
        fingerprint,
        signature: Array.from(signature),
      }),
      200,
    );
    const authorized = {
      authorization: `Bearer ${stringField(verified, "token")}`,
    };

    // Concurrent requests each open their own pool; none may inherit a
    // socket another request opened.
    const sessions = await Promise.all(
      [1, 2, 3].map(() =>
        fetch(`${base}/auth/sessions`, { headers: authorized }),
      ),
    );
    expect(sessions.map((response) => response.status)).toEqual([
      200, 200, 200,
    ]);

    // A one-time ticket opens exactly one socket on the hub.
    const ticket = await expectJson(
      await fetch(`${base}/auth/ws-ticket`, {
        method: "POST",
        headers: authorized,
      }),
      200,
    );
    const eventsUrl = `${base}/events?ticket=${stringField(ticket, "ticket")}`;
    expect(await openSocket(eventsUrl.replace(/^http/, "ws"))).toEqual({
      code: 1000,
    });
    const replay = await fetch(eventsUrl, {
      headers: { upgrade: "websocket", connection: "upgrade" },
    });
    expect(replay.status).toBe(401);
    // Without an upgrade the request never reaches the hub.
    expect((await fetch(`${base}/events`)).status).toBe(404);

    await expectJson(
      await fetch(`${base}/auth/logout`, {
        method: "POST",
        headers: authorized,
      }),
      200,
    );
    const afterLogout = await fetch(`${base}/auth/sessions`, {
      headers: authorized,
    });
    expect(afterLogout.status).toBe(401);
  }, 120_000);

  test("dispatches the billing Cron to the maintenance phases", async () => {
    const response = await fetch(
      `${worker.origin}/__scheduled?cron=${encodeURIComponent("* * * * *")}`,
    );
    expect(`${response.status} ${await response.text()}`).toBe(
      "200 Ran scheduled event",
    );
  }, 60_000);
});
