import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTestUser } from "@tearleads/test-utils";
import { isContainerMutationResponse } from "@tearleads/validators/response";
import { authenticate } from "../../test/helpers/authenticate";
import {
  accessManifestFromContainerResponse,
  bootstrapRoot,
  buildRootGrantRequest,
  kekStateFromContainerResponse,
} from "../../test/helpers/keyingWriterProjectionKit";
import { buildRootRevokeRequest } from "../../test/helpers/keyingWriterProjectionRevoke";
import {
  attachWorkerLogs,
  databaseKind,
  expectJson,
  field,
  type LocalWorker,
  loginThroughWorker,
  openRealtimeSocket,
  postJson,
  START_TIMEOUT_MS,
  startLocalWorker,
  waitForFrame,
} from "../../test/helpers/localWorker";
import { registerUser } from "../../test/helpers/registerUser";

/**
 * Container interest through the realtime hub in workerd: a declaration is
 * authorized against the database, a mutation from another session reaches
 * the declared socket, and revoking a grant drops the revoked user's
 * interest. The users and signed mutations come from the in-process fixtures
 * over the shared lane database; the Worker handles every request and socket.
 */
describe.skipIf(databaseKind !== "postgres")("Worker runtime interest", () => {
  let worker: LocalWorker;

  beforeAll(async () => {
    worker = await startLocalWorker();
    attachWorkerLogs(worker.logs);
  }, START_TIMEOUT_MS + 10_000);

  afterAll(async () => {
    await worker?.stop();
  });

  test("authorizes, delivers, and revokes container interest", async () => {
    const base = worker.origin;
    const owner = createTestUser();
    const recipient = createTestUser();
    // In-process sessions let the signed-mutation fixtures read what they
    // need; the Worker issues its own sessions below.
    await registerUser(owner);
    await authenticate(owner);
    await registerUser(recipient);
    await authenticate(recipient);
    const root = await bootstrapRoot(owner);
    const rootId = root.kekState.containerId;

    // The owner watches from one session and writes from another, so the
    // hub's author exclusion does not hide the write from the watcher.
    const ownerSocket = await openRealtimeSocket(
      base,
      await loginThroughWorker(base, owner),
    );
    const ownerToken = await loginThroughWorker(base, owner);
    const recipientSocket = await openRealtimeSocket(
      base,
      await loginThroughWorker(base, recipient),
    );
    const declare = (
      socket: { readonly socket: WebSocket },
      declarationId: string,
      containerIds: readonly string[],
    ) =>
      socket.socket.send(
        JSON.stringify({
          type: "known_containers",
          declarationId,
          containerIds,
        }),
      );

    // Authorization: the owner's root is accepted, a foreign id is not.
    declare(ownerSocket, "owner-1", [rootId, crypto.randomUUID()]);
    expect(
      await waitForFrame(
        ownerSocket.frames,
        (frame) => field(frame, "declarationId") === "owner-1",
        "owner acknowledgement",
      ),
    ).toEqual({
      type: "known_containers_ack",
      declarationId: "owner-1",
      containerIds: [rootId],
    });
    declare(recipientSocket, "recipient-1", [rootId]);
    expect(
      await waitForFrame(
        recipientSocket.frames,
        (frame) => field(frame, "declarationId") === "recipient-1",
        "recipient acknowledgement before the grant",
      ),
    ).toEqual({
      type: "known_containers_ack",
      declarationId: "recipient-1",
      containerIds: [],
    });

    // Delivery: the owner's other session grants the recipient; the watching
    // socket hears about the root mutation.
    const shared = await expectJson(
      await postJson(
        `${base}/containers/${rootId}/share`,
        await buildRootGrantRequest({
          previous: root.bundle,
          previousKekState: root.kekState,
          recipient,
          signer: owner,
        }),
        { authorization: `Bearer ${ownerToken}` },
      ),
      200,
    );
    if (!isContainerMutationResponse(shared)) {
      throw new Error(`Unexpected share response ${JSON.stringify(shared)}`);
    }
    const hint = await waitForFrame(
      ownerSocket.frames,
      (frame) =>
        field(frame, "type") === "container_mutation_created" &&
        field(frame, "containerId") === rootId,
      "container mutation hint",
    );
    expect(field(hint, "eventType")).toBe("container.grant");

    // Now the recipient's declaration is authorized.
    declare(recipientSocket, "recipient-2", [rootId]);
    expect(
      await waitForFrame(
        recipientSocket.frames,
        (frame) => field(frame, "declarationId") === "recipient-2",
        "recipient acknowledgement after the grant",
      ),
    ).toEqual({
      type: "known_containers_ack",
      declarationId: "recipient-2",
      containerIds: [rootId],
    });

    // Revocation: the owner revokes the grant; the hub drops the recipient's
    // interest and tells the client to resync.
    await expectJson(
      await postJson(
        `${base}/containers/${rootId}/revoke`,
        await buildRootRevokeRequest({
          previous: await accessManifestFromContainerResponse(shared),
          previousKekState: await kekStateFromContainerResponse(shared),
          revokedUser: recipient,
          signer: owner,
        }),
        { authorization: `Bearer ${ownerToken}` },
      ),
      200,
    );
    expect(
      await waitForFrame(
        recipientSocket.frames,
        (frame) => field(frame, "type") === "resync_required",
        "resync after revocation",
      ),
    ).toEqual({ type: "resync_required", containerIds: [rootId] });
    declare(recipientSocket, "recipient-3", [rootId]);
    expect(
      await waitForFrame(
        recipientSocket.frames,
        (frame) => field(frame, "declarationId") === "recipient-3",
        "recipient acknowledgement after revocation",
      ),
    ).toEqual({
      type: "known_containers_ack",
      declarationId: "recipient-3",
      containerIds: [],
    });

    ownerSocket.socket.close(1000, "done");
    recipientSocket.socket.close(1000, "done");
  }, 120_000);
});
