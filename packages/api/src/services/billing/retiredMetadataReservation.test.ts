import { expect, test } from "bun:test";
import {
  containerMetadataDocuments,
  organizationBilling,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import { eq } from "drizzle-orm";
import { authenticate } from "../../../test/helpers/authenticate";
import { createChildContainer } from "../../../test/helpers/keyingWriterProjectionChild";
import {
  asVerifiedContainerManifest,
  bootstrapRoot,
  createDocumentRequest,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../test/helpers/registerUser";
import { createServiceTestRuntime } from "../../../test/helpers/serviceRuntime";
import { routeApp } from "../../routeApp";
import { runOrganizationPurgeMaintenance } from "./organizationPurge";

test("retired metadata IDs remain reserved after the former organization is purged", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const child = await createChildContainer({ parent: root, signer: owner });
  const state = asVerifiedContainerManifest(child.accessManifest).state;
  const deleted = await routeApp.request(`/containers/${child.containerId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${owner.token}` },
  });
  expect(deleted.status).toBe(200);
  const runtime = createServiceTestRuntime();
  const now = new Date();
  await runtime.db
    .update(organizationBilling)
    .set({ status: "disabled", purgeAfter: new Date(now.getTime() - 1) })
    .where(eq(organizationBilling.organizationId, state.organizationId));
  expect(
    await runOrganizationPurgeMaintenance(runtime, {
      organizationIds: [state.organizationId],
      now,
    }),
  ).toEqual({ claimed: 1, failed: 0, purged: 1 });
  expect(
    await runtime.db
      .select()
      .from(containerMetadataDocuments)
      .where(
        eq(containerMetadataDocuments.documentId, state.metadataDocumentId),
      ),
  ).toHaveLength(1);

  const nextOwner = createTestUser();
  await registerUser(nextOwner);
  await authenticate(nextOwner);
  const nextRoot = await bootstrapRoot(nextOwner);
  const recreated = await routeApp.request("/documents", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${nextOwner.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(
      await createDocumentRequest({
        owner: nextOwner,
        root: nextRoot,
        documentId: state.metadataDocumentId,
      }),
    ),
  });
  expect(recreated.status).toBe(409);
  expect(await recreated.json()).toEqual({
    error: "Document ID belongs to a deleted container",
  });
});
