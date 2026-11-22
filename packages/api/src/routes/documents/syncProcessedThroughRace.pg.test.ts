import { expect, test } from "bun:test";
import { getDefaultApiDatabaseKind } from "@tearleads/api-shared/postgres";
import { documentUpdates } from "@tearleads/api-shared/schema";
import { computeWriteHeaderHash } from "@tearleads/crypto";
import { createTestUser } from "@tearleads/test-utils";
import type { DocumentSyncResponse } from "@tearleads/validators/response";
import { authenticate } from "../../../test/helpers/authenticate";
import { createSignedDocumentSyncRequest } from "../../../test/helpers/documentUpdateRequests";
import {
  bootstrapRoot,
  createDocument,
} from "../../../test/helpers/keyingWriterProjectionKit";
import {
  holdPostgresLock,
  waitForPostgresLockWait,
} from "../../../test/helpers/postgresConcurrency";
import { registerUser } from "../../../test/helpers/registerUser";
import { postDocumentSync } from "../../../test/helpers/staleBundleHealKit";
import { resolveCurrentDocumentKekTargets } from "../../access/read/documentKekTargets";
import { storeDocumentContentWriteHeader } from "../../access/shared/internal/documentContentWriteHeaderStore";
import { insertDocumentUpdateSpans } from "../../documents/documentUpdateSpans";
import { readWriteHeader } from "../../workflows/documents/mutations/shared/records";
import { lockSyncDocumentWriteFrontier } from "../../workflows/documents/mutations/syncWriteFrontier";

const databaseKind = getDefaultApiDatabaseKind();

// A processed cursor outlives the pull that set it, so the pull's upper bound
// must never name a position past an update still being written: the reader
// would then skip that update for good once it commits.
test.skipIf(databaseKind !== "postgres")(
  "a pull's processed position never passes an update committed during it",
  async () => {
    const owner = createTestUser();
    await registerUser(owner);
    await authenticate(owner);
    const root = await bootstrapRoot(owner);
    const created = await createDocument({ owner, root });
    const { request, updateId } = await createSignedDocumentSyncRequest({
      created,
      owner,
      root,
    });
    const update = request.outgoingUpdates[0];
    if (!update) throw new Error("Expected a signed outgoing update");

    const holder = await holdPostgresLock(async (tx) => {
      const currentTargets = await resolveCurrentDocumentKekTargets(
        created.id,
        tx,
      );
      await lockSyncDocumentWriteFrontier({
        authorizingContainerIds: [],
        documentId: created.id,
        frontier: {
          linkSetManifestHash: currentTargets.linkSetManifestHash,
          linkedContainerIds: currentTargets.targets.map(
            (target) => target.containerId,
          ),
        },
        tx,
      });
      await tx.insert(documentUpdates).values({
        accessEpoch: currentTargets.linkSetEpoch,
        authorFingerprint: owner.fingerprint,
        byteLength: new TextEncoder().encode(update.encryptedData).byteLength,
        documentId: created.id,
        encryptedData: update.encryptedData,
        id: updateId,
        partialEndVersionVector: update.partialEndVersionVector,
        partialStartVersionVector: update.partialStartVersionVector,
        plaintextHash: update.plaintextHash,
      });
      // The rest of what a commit writes with the row, so the pull can serve
      // it once this transaction commits.
      await insertDocumentUpdateSpans(tx, {
        documentId: created.id,
        updates: [update],
      });
      const header = readWriteHeader(update.writeHeader, "write header");
      await storeDocumentContentWriteHeader(
        {
          authorizationTargets: currentTargets.targets,
          documentId: created.id,
          header,
          headerHash: await computeWriteHeaderHash(header),
          updateId,
        },
        tx,
      );
    });

    const pull = postDocumentSync(owner, created.id, {
      contentKeyEpoch: created.contentKeyEpoch,
      expectedLinkSetManifestHash: created.manifestHash,
      expectedTargetHash: created.targetHash,
      localVersionVector: null,
      outgoingUpdates: [],
      supportsPullPagination: true,
    });
    try {
      await waitForPostgresLockWait({
        blockerPid: holder.backendPid,
        queryFragment: "access_manifest_heads",
      });
    } finally {
      await holder.release();
    }
    const response = await pull;
    expect(response.status).toBe(200);
    const body = (await response.json()) as DocumentSyncResponse;
    expect(body.pullPage.throughUpdateId).toBe(updateId);
    expect(body.updates.map(({ id }) => id)).toContain(updateId);
  },
  30_000,
);
