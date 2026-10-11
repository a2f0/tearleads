import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTestUser } from "@tearleads/bob-and-alice";
import { createRegistrationRequestBody } from "../../test/helpers/api/submitRegistration";
import { startFakeStartTlsPostgres } from "../../test/helpers/fakeStartTlsPostgres";
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
