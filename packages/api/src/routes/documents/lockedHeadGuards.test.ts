import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { accessManifestHeads } from "@tearleads/api-shared/schema";
import { and, eq } from "drizzle-orm";
import { documentHeadGuardFixture } from "../../../test/helpers/documentHeadGuardFixture";
import {
  getCurrentAccessManifestHead,
  getCurrentAccessManifestHeads,
} from "../../access/read/accessManifestStore";
import { lockAttachmentAuthorizationHeadsForShare } from "../../workflows/blobs/mutations/authorizationLocks";
import { lockDocumentLinkSetMutationHeads } from "../../workflows/documents/mutations/linkSetMutationLocks";
import { assertDocumentLinkSetCanAdvance } from "../../workflows/documents/mutations/shared/documentRows";

test("the advance comparison independently refuses a valid stale previous manifest", async () => {
  const fixture = await documentHeadGuardFixture();
  await db.transaction(async (executor) => {
    const lockInput = {
      documentId: fixture.document.id,
      executor,
      previousLinkedContainerIds:
        fixture.currentManifest.state.linkedContainerIds,
      request: fixture.nextRequest,
    };
    await lockDocumentLinkSetMutationHeads(lockInput);
    const lockedHead = await getCurrentAccessManifestHead(
      "document",
      fixture.document.id,
      executor,
    );
    const input = {
      documentId: fixture.document.id,
      executor,
      lockedHead,
      manifest: fixture.currentManifest,
      previousManifest: fixture.currentManifest,
    };
    await assertDocumentLinkSetCanAdvance(input);
    const stale = { ...input, previousManifest: fixture.previousManifest };
    const failure = await assertDocumentLinkSetCanAdvance(stale).catch(
      (error: unknown) => error,
    );
    expect(failure).toMatchObject({
      status: 409,
      message: "Document manifest is stale",
    });
    // Id mismatch remains earlier than missing head, which remains earlier
    // than the stale-hash comparison; null never means "read another row".
    const missing = { ...input, lockedHead: null };
    expect(
      await assertDocumentLinkSetCanAdvance(missing).catch(
        (error: unknown) => error,
      ),
    ).toMatchObject({ status: 404, message: "Document manifest head missing" });
    expect(
      await assertDocumentLinkSetCanAdvance({
        ...missing,
        documentId: crypto.randomUUID(),
      }).catch((error: unknown) => error),
    ).toMatchObject({ status: 400, message: "Document id mismatch" });
  });
});

test("head lock results contain only acquired rows and refresh after self writes", async () => {
  const fixture = await documentHeadGuardFixture();
  const missingId = crypto.randomUUID();
  await db.transaction(async (executor) => {
    const containerIds = [
      fixture.child.containerId,
      missingId,
      fixture.root.kekState.containerId,
      fixture.child.containerId,
    ];
    const input = {
      documentId: fixture.document.id,
      executor,
      previousLinkedContainerIds: containerIds,
      request: fixture.nextRequest,
    };
    const first: unknown = await lockDocumentLinkSetMutationHeads(input);
    const containerHeads = await getCurrentAccessManifestHeads(
      "container",
      containerIds,
      executor,
    );
    expect(first).toEqual({
      containerHeads,
      documentHead: fixture.currentHead,
    });
    expect(containerHeads.has(missingId)).toBe(false);
    await executor
      .update(accessManifestHeads)
      .set({
        manifestHash: fixture.previousHead.manifestHash,
        epoch: fixture.previousHead.epoch,
      })
      .where(
        and(
          eq(accessManifestHeads.objectKind, "document"),
          eq(accessManifestHeads.objectId, fixture.document.id),
        ),
      );
    const afterWrite: unknown = await lockDocumentLinkSetMutationHeads(input);
    expect(afterWrite).toEqual({
      containerHeads,
      documentHead: await getCurrentAccessManifestHead(
        "document",
        fixture.document.id,
        executor,
      ),
    });
    expect(afterWrite).not.toEqual(first);
    const absent: unknown = await lockDocumentLinkSetMutationHeads({
      ...input,
      documentId: missingId,
    });
    expect(absent).toEqual({ containerHeads, documentHead: null });
  });
});

test("attachment locks refuse planned heads that were not actually acquired", async () => {
  const fixture = await documentHeadGuardFixture();
  await db.transaction(async (executor) => {
    const input = {
      containerIds: [
        fixture.root.kekState.containerId,
        fixture.root.kekState.containerId,
      ],
      documentIds: [fixture.document.id, fixture.document.id],
      executor,
    };
    expect<unknown>(
      await lockAttachmentAuthorizationHeadsForShare(input),
    ).toEqual({
      containerHeads: await getCurrentAccessManifestHeads(
        "container",
        input.containerIds,
        executor,
      ),
      documentHeads: await getCurrentAccessManifestHeads(
        "document",
        input.documentIds,
        executor,
      ),
    });
    for (const missingKind of ["containerIds", "documentIds"] as const) {
      const failure = await lockAttachmentAuthorizationHeadsForShare({
        ...input,
        [missingKind]: [...input[missingKind], crypto.randomUUID()],
      }).catch((error: unknown) => error);
      expect(failure).toMatchObject({
        status: 409,
        message: "Blob content-key target heads are stale",
      });
    }
  });
});
