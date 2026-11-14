import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { documentUpdates } from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/test-utils";
import { isDocumentCreateResponse } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import { buildRootContainerRekeyMutation } from "../../../test/helpers/containerRekey";
import type { CreatedDocumentFixture } from "../../../test/helpers/documentAcknowledgementFixture";
import { createSignedDocumentSyncRequest } from "../../../test/helpers/documentUpdateRequests";
import {
  bootstrapRoot,
  createDocumentRequest,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../test/helpers/registerUser";
import { getCurrentAccessManifestHead } from "../../access/read/accessManifestStore";
import { routeApp } from "../../routeApp";

test.each([false, true])(
  "seeded create uses post-rekey locked heads (stale seed: %s)",
  async (staleSeed) => {
    const owner = createTestUser();
    await registerUser(owner);
    await authenticate(owner);
    const root = await bootstrapRoot(owner);
    const rekey = await buildRootContainerRekeyMutation({
      previous: root,
      signer: owner,
    });
    const nextRoot = {
      bundle: rekey.bundle,
      kekState: rekey.kekState,
      principalPolicies: root.principalPolicies,
    };
    const create = await createDocumentRequest({ owner, root: nextRoot });
    const planned = {
      accessManifest: { state: create.manifest },
      contentKeyBundle: create.contentKeyBundle,
      id: String(Reflect.get(create.manifest, "objectId")),
    } as unknown as CreatedDocumentFixture;
    // The stale seed still has a valid signature and matching dependency hashes.
    // The head pin must keep its 409 precedence over later target-scope checks.
    const { request: seed } = await createSignedDocumentSyncRequest({
      created: planned,
      owner,
      root: staleSeed ? root : nextRoot,
    });
    const [update] = seed.outgoingUpdates;
    invariant(update, "expected seeded update");
    const response = await routeApp.request("/documents", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...create,
        containerRekeys: [rekey.request],
        initialSync: {
          ...seed,
          localVersionVector: update.partialEndVersionVector,
        },
      }),
    });
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(staleSeed ? 409 : 200);
    const rootHead = await getCurrentAccessManifestHead(
      "container",
      root.kekState.containerId,
      db,
    );
    const documentHead = await getCurrentAccessManifestHead(
      "document",
      planned.id,
      db,
    );
    const updates = await db
      .select({ id: documentUpdates.id })
      .from(documentUpdates)
      .where(eq(documentUpdates.documentId, planned.id));
    if (staleSeed) {
      expect(body.error).toContain("is stale");
      expect(rootHead?.manifestHash).toBe(root.bundle.manifestHash);
      expect(documentHead).toBeNull();
      expect(updates).toEqual([]);
    } else {
      invariant(isDocumentCreateResponse(body), "expected seeded creation");
      expect(body.id).toBe(planned.id);
      expect(body.initialSync?.acceptedOutgoingUpdateIds).toEqual([update.id]);
      expect(rootHead?.manifestHash).toBe(rekey.bundle.manifestHash);
      expect(documentHead?.manifestHash).toBe(create.expectedManifestHash);
      expect(updates).toEqual([{ id: update.id }]);
    }
  },
);
