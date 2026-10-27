import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTestUser } from "@tearleads/test-utils";
import { createRegistrationRequestBody } from "../../test/helpers/api/submitRegistration";
import { authenticate } from "../../test/helpers/authenticate";
import { startFakeStartTlsPostgres } from "../../test/helpers/fakeStartTlsPostgres";
import {
  bootstrapRoot,
  createDocument,
} from "../../test/helpers/keyingWriterProjectionKit";
import {
  attachWorkerLogs,
  BUILD_VERSION,
  databaseKind,
  expectJson,
  type LocalWorker,
  loginThroughWorker,
  openSocket,
  postJson,
  START_TIMEOUT_MS,
  startLocalWorker,
  stringField,
} from "../../test/helpers/localWorker";
import { registerUser } from "../../test/helpers/registerUser";

/**
 * The deployed entry in workerd: health with the build version, registration,
 * login, concurrent reads on request-scoped pools, one socket per ticket,
 * the hub closing a session's socket on logout, Cron dispatch, and the
 * Postgres transport refusing an untrusted certificate. Bun tests cover the
 * pieces; these cover the seams that only exist in the runtime.
 */
describe.skipIf(databaseKind !== "postgres")("Worker runtime", () => {
  let worker: LocalWorker;

  beforeAll(async () => {
    worker = await startLocalWorker();
    attachWorkerLogs(worker.logs);
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

  test("serves SDK preflights and auth failures from arbitrary origins", async () => {
    const origin = "https://external-sdk.example";
    const preflight = await fetch(`${worker.origin}/auth/ws-ticket`, {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type",
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(
      preflight.headers.get("Access-Control-Allow-Headers")?.toLowerCase(),
    ).toContain("authorization");
    expect(
      preflight.headers.get("Access-Control-Allow-Credentials"),
    ).toBeNull();
    const protectedResponse = await fetch(`${worker.origin}/auth/sessions`, {
      headers: { Origin: origin },
    });
    expect(protectedResponse.status).toBe(401);
    expect(protectedResponse.headers.get("Access-Control-Allow-Origin")).toBe(
      "*",
    );
  });

  test("registers, logs in, serves concurrent reads, opens one socket per ticket, and closes it on logout", async () => {
    const base = worker.origin;
    const user = createTestUser();
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

    const authorized = {
      authorization: `Bearer ${await loginThroughWorker(base, user)}`,
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
    const live = await openSocket(eventsUrl.replace(/^http/, "ws"));
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
    // Logout publishes the revocation to the hub, which closes the session's
    // socket itself; the client never asked for it.
    const closure = await Promise.race([
      live.closed,
      Bun.sleep(15_000).then(() => "still open"),
    ]);
    if (closure === "still open") {
      throw new Error(
        `Socket stayed open after logout\nWorker output:\n${worker.logs().slice(-6000)}`,
      );
    }
    expect(closure).toEqual({ code: 1008, reason: "Session revoked" });
    expect(live.socket.readyState).toBe(WebSocket.CLOSED);
  }, 120_000);

  test("caps open sockets per session at eight", async () => {
    const base = worker.origin;
    const user = createTestUser();
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
    const authorized = {
      authorization: `Bearer ${await loginThroughWorker(base, user)}`,
    };
    const ticketUrl = async () => {
      const ticket = await expectJson(
        await fetch(`${base}/auth/ws-ticket`, {
          method: "POST",
          headers: authorized,
        }),
        200,
      );
      return `${base}/events?ticket=${stringField(ticket, "ticket")}`;
    };
    const open = [];
    try {
      for (let index = 0; index < 8; index++) {
        open.push(await openSocket((await ticketUrl()).replace(/^http/, "ws")));
      }
      const ninth = await fetch(await ticketUrl(), {
        headers: { upgrade: "websocket", connection: "upgrade" },
      });
      expect(`${ninth.status} ${await ninth.text()}`).toBe(
        "429 Too many sockets for this session",
      );
    } finally {
      for (const socket of open) {
        socket.socket.close(1000, "done");
      }
    }
    // Closing one frees a slot.
    await Bun.sleep(500);
    const again = await openSocket((await ticketUrl()).replace(/^http/, "ws"));
    again.socket.close(1000, "done");
  }, 120_000);

  test("serves a body under the ceiling through its route", async () => {
    // The ingress bounds themselves (a declared length above the ceiling, a
    // chunked body overrunning it) answer before the client finishes
    // sending, which the local runtime's proxy cannot relay: it reports the
    // early answer as a lost connection. Those cases are covered by the
    // `boundRequestBody` and JSON validator unit tests and verified against
    // the deployed tiers by the live smoke; here the route answers a body
    // just under the guest ceiling.
    const underCeiling = await postJson(`${worker.origin}/auth/challenge`, {
      padding: "x".repeat(1024 * 1024),
    });
    expect(underCeiling.status).toBe(400);
  }, 60_000);

  test("overlapping document syncs from two sessions finish without upload refusals", async () => {
    const owner = createTestUser();
    await registerUser(owner);
    await authenticate(owner);
    const root = await bootstrapRoot(owner);
    const document = await createDocument({ owner, root });
    const tokens = [
      await loginThroughWorker(worker.origin, owner),
      await loginThroughWorker(worker.origin, owner),
    ];
    const url = `${worker.origin}/documents/${document.id}/sync`;
    const request = {
      contentKeyEpoch: document.contentKeyBundle.contentKeyEpoch,
      expectedLinkSetManifestHash:
        document.contentKeyBundle.linkSetManifestHash,
      expectedTargetHash: document.contentKeyBundle.targetHash,
      localVersionVector: null,
      outgoingUpdates: [],
      supportsPullPagination: true,
    };
    // A tiny metadata sync still reserves the maximum possible response page.
    // A move can overlap several of these pulls across the two browsers.
    const responses = await Promise.all(
      tokens.flatMap((token) =>
        Array.from({ length: 3 }, async () =>
          expectJson(
            await postJson(url, request, { authorization: `Bearer ${token}` }),
            200,
          ),
        ),
      ),
    );
    expect(responses).toHaveLength(6);
    expect(
      await expectJson(
        await postJson(url, request, {
          authorization: `Bearer ${tokens[0]}`,
        }),
        200,
      ),
    ).toHaveProperty("updates");
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

describe.skipIf(databaseKind !== "postgres")(
  "Worker runtime over STARTTLS",
  () => {
    test(
      "refuses an untrusted certificate before sending credentials",
      async () => {
        const fake = await startFakeStartTlsPostgres();
        const worker = await startLocalWorker({
          POSTGRES_HOST: "127.0.0.1",
          POSTGRES_PORT: String(fake.port),
          POSTGRES_USER: "impostor",
          POSTGRES_PASSWORD: "never-sent",
          POSTGRES_DATABASE: "impostor",
          POSTGRES_SSL: "true",
          POSTGRES_SSL_REJECT_UNAUTHORIZED: "true",
        });
        try {
          const response = await postJson(`${worker.origin}/auth/challenge`, {
            fingerprint: "0".repeat(64),
          });
          expect(response.status).toBeGreaterThanOrEqual(500);
          await Bun.sleep(1_500);
          // The transport asked for TLS first, the runtime refused the
          // certificate, and no startup message (with its credentials) followed.
          expect(fake.events()).toContain("ssl request");
          expect(fake.events()).not.toContain("plaintext startup");
          expect(fake.events()).not.toContain("startup over tls");
          expect(worker.logs()).toContain(
            "TLS negotiation with the database failed",
          );
        } finally {
          await worker.stop();
          await fake.stop();
        }
      },
      START_TIMEOUT_MS + 30_000,
    );
  },
);
