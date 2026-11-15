import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  blobContentKeyEpochs,
  blobContentKeyTargets,
} from "@tearleads/api-shared/schema";
import { eq, inArray } from "drizzle-orm";
import {
  blobRewrapFixture,
  expectBlobRewrapUnchanged,
  postBlobRewrap,
  snapshotBlobRewrap,
} from "../../../test/helpers/blobRewrapReadbackKit";
import { buildDocumentLinkRequest } from "../../../test/helpers/documentLinkMutation";
import { createServiceTestRuntime } from "../../../test/helpers/serviceRuntime";
import { probeTransactions } from "../../../test/helpers/transactionProgress";
import { BlobContentKeyBundleError } from "../../access/write/blobContentKeyStore";
import { createRouteApp } from "../../routeApp";

for (const failure of [
  "missing epoch",
  "after epoch write",
  "after target write",
] as const) {
  test(`signed blob rewrap rolls back ${failure}`, async () => {
    const fixture = await blobRewrapFixture();
    const request = await buildDocumentLinkRequest({
      ...fixture,
      createdDocument: fixture.document,
      blobRewraps: [
        {
          blobId: fixture.blobId,
          contentKeyEpoch: 1,
          targets: [fixture.rootTarget, fixture.childTarget],
        },
      ],
    });
    const before = await snapshotBlobRewrap(fixture);
    let reached = 0;
    const observed = probeTransactions(db, {
      before: async (query, tx) => {
        if (
          failure !== "missing epoch" ||
          !query.startsWith('update "blob_content_key_epochs"')
        )
          return;
        reached += 1;
        // A real zero-row UPDATE RETURNING, after all signed/current-target checks.
        await tx
          .delete(blobContentKeyTargets)
          .where(
            inArray(
              blobContentKeyTargets.blobContentKeyEpochId,
              tx
                .select({ id: blobContentKeyEpochs.id })
                .from(blobContentKeyEpochs)
                .where(eq(blobContentKeyEpochs.blobId, fixture.blobId)),
            ),
          );
        await tx
          .delete(blobContentKeyEpochs)
          .where(eq(blobContentKeyEpochs.blobId, fixture.blobId));
      },
      after: async (query) => {
        const matches =
          failure === "after epoch write"
            ? query.startsWith('update "blob_content_key_epochs"')
            : failure === "after target write" &&
              query.startsWith('insert into "blob_content_key_targets"');
        if (!matches) return;
        reached += 1;
        throw new BlobContentKeyBundleError(`injected ${failure}`, 409);
      },
    });
    const response = await postBlobRewrap(
      fixture,
      "link",
      request,
      createRouteApp({ runtime: createServiceTestRuntime(observed.database) }),
    );
    expect(reached).toBe(1);
    expect(response).toEqual({
      status: 409,
      body: {
        error:
          failure === "missing epoch"
            ? "Failed to load blob content-key epoch"
            : `injected ${failure}`,
      },
    });
    await expectBlobRewrapUnchanged(fixture, before);
  });
}
