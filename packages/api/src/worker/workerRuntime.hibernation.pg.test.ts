import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTestUser } from "@tearleads/bob-and-alice";
import { authenticate } from "../../test/helpers/authenticate";
import { startHibernatingWorker } from "../../test/helpers/hibernatingWorker";
import { bootstrapRoot } from "../../test/helpers/keyingWriterProjectionKit";
import {
  attachWorkerLogs,
  databaseKind,
  expectJson,
  field,
  loginThroughWorker,
  openRealtimeSocket,
  postJson,
  START_TIMEOUT_MS,
  stringField,
  waitForFrame,
} from "../../test/helpers/localWorker";
import { registerUser } from "../../test/helpers/registerUser";

describe.skipIf(databaseKind !== "postgres")(
  "Worker runtime hibernation",
  () => {
    let worker: Awaited<ReturnType<typeof startHibernatingWorker>>;
    beforeAll(async () => {
      worker = await startHibernatingWorker();
      attachWorkerLogs(worker.logs);
    }, START_TIMEOUT_MS + 10_000);
    afterAll(async () => {
      await worker?.stop();
    });

    test("a publish wakes sockets with distinct interest and logout still closes them", async () => {
      const user = createTestUser();
      await registerUser(user);
      await authenticate(user);
      const firstRoot = await bootstrapRoot(user);
      const firstId = firstRoot.kekState.containerId;
      const secondId = firstId;
      const token = await loginThroughWorker(worker.origin, user);
      const a = await openRealtimeSocket(worker.origin, token);
      const b = await openRealtimeSocket(worker.origin, token);
      for (const [socket, id] of [
        [a, firstId],
        [b, "empty"],
      ] as const) {
        socket.socket.send(
          JSON.stringify({
            type: "known_containers",
            declarationId: id,
            containerIds: id === "empty" ? [] : [id],
          }),
        );
        const ack = await waitForFrame(
          socket.frames,
          (frame) => field(frame, "declarationId") === id,
          "declaration acknowledgement",
        );
        expect(field(ack, "containerIds")).toEqual(id === "empty" ? [] : [id]);
      }
      await worker.command({ kind: "hibernate" });
      expect(a.socket.readyState).toBe(WebSocket.OPEN);
      expect(b.socket.readyState).toBe(WebSocket.OPEN);
      // The server event is the first event after eviction. No client message
      // reconstructs the routing, and the shared session cache contains b's empty set.
      await worker.command({
        kind: "publish",
        message: JSON.stringify({
          type: "access_changed",
          containerId: firstId,
        }),
      });
      expect(
        await waitForFrame(
          a.frames,
          (frame) => field(frame, "type") === "resync_required",
          "restored interest invalidation",
        ),
      ).toEqual({ type: "resync_required", containerIds: [firstId] });
      expect(
        b
          .frames()
          .some((frame) => JSON.stringify(frame).includes("resync_required")),
      ).toBe(false);
      b.socket.send(
        JSON.stringify({
          type: "known_containers",
          declarationId: "second",
          containerIds: [secondId],
        }),
      );
      await waitForFrame(
        b.frames,
        (frame) => field(frame, "declarationId") === "second",
        "second declaration",
      );
      await worker.command({ kind: "hibernate" });
      await worker.command({
        kind: "publish",
        message: JSON.stringify({
          type: "access_changed",
          containerId: secondId,
        }),
      });
      expect(
        await waitForFrame(
          b.frames,
          (frame) => field(frame, "type") === "resync_required",
          "second socket invalidation",
        ),
      ).toEqual({ type: "resync_required", containerIds: [secondId] });
      await worker.command({ kind: "hibernate" });
      const logout = await postJson(
        `${worker.origin}/auth/logout`,
        {},
        { authorization: `Bearer ${token}` },
      );
      expect(logout.status).toBe(200);
      expect((await a.closed).code).toBe(1008);
      expect((await b.closed).code).toBe(1008);
    }, 120_000);
    test("a durable alarm wakes an idle hub and closes an expired session", async () => {
      const user = createTestUser();
      await registerUser(user);
      const token = await loginThroughWorker(worker.origin, user);
      const socket = await openRealtimeSocket(worker.origin, token);
      // Deleting the session without publication models natural expiry or a
      // missed revocation. Bring its persisted check forward to keep the test short.
      await worker.command({ kind: "expire-session", token });
      await worker.command({ kind: "schedule-session-check" });
      await worker.command({ kind: "hibernate" });
      await worker.command({ kind: "publish", message: "{}" });
      expect(socket.socket.readyState).toBe(WebSocket.OPEN);
      const closed = await Promise.race([
        socket.closed,
        Bun.sleep(10_000).then(() => {
          throw new Error("Durable alarm did not close expired session");
        }),
      ]);
      expect(closed.code).toBe(1008);
      expect(closed.reason).toBe("Session ended");
    }, 30_000);

    test("expired proofs are evicted before routing the event that wakes the hub", async () => {
      const user = createTestUser();
      await registerUser(user);
      await authenticate(user);
      const root = await bootstrapRoot(user);
      const id = root.kekState.containerId;
      const socket = await openRealtimeSocket(
        worker.origin,
        await loginThroughWorker(worker.origin, user),
      );
      socket.socket.send(
        JSON.stringify({
          type: "known_containers",
          declarationId: "proof",
          containerIds: [id],
        }),
      );
      await waitForFrame(
        socket.frames,
        (frame) => field(frame, "declarationId") === "proof",
        "proof acknowledgement",
      );
      await worker.command({ kind: "expire-proofs" });
      await worker.command({ kind: "hibernate" });
      await worker.command({
        kind: "publish",
        message: JSON.stringify({
          type: "document_update_created",
          documentId: "must-not-leak",
          containerIds: [id],
        }),
      });
      expect(
        await waitForFrame(
          socket.frames,
          (frame) => field(frame, "type") === "resync_required",
          "expired proof invalidation",
        ),
      ).toEqual({ type: "resync_required", containerIds: [id] });
      expect(
        socket
          .frames()
          .some((frame) => JSON.stringify(frame).includes("must-not-leak")),
      ).toBe(false);
      expect(socket.socket.readyState).toBe(WebSocket.OPEN);
      socket.socket.close(1000, "done");
    }, 30_000);

    test("hibernation retains the per-session socket limit", async () => {
      const user = createTestUser();
      await registerUser(user);
      const token = await loginThroughWorker(worker.origin, user);
      const sockets: Array<Awaited<ReturnType<typeof openRealtimeSocket>>> = [];
      try {
        for (let count = 0; count < 8; count++)
          sockets.push(await openRealtimeSocket(worker.origin, token));
        await worker.command({ kind: "hibernate" });
        const ticket = await expectJson(
          await fetch(`${worker.origin}/auth/ws-ticket`, {
            method: "POST",
            headers: { authorization: `Bearer ${token}` },
          }),
          200,
        );
        const rejected = await fetch(
          `${worker.origin}/events?ticket=${stringField(ticket, "ticket")}`,
          { headers: { upgrade: "websocket", connection: "upgrade" } },
        );
        expect(rejected.status).toBe(429);
        expect(await rejected.text()).toBe("Too many sockets for this session");
      } finally {
        for (const socket of sockets) socket.socket.close(1000, "done");
      }
    }, 30_000);
  },
);
