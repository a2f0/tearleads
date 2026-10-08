import { expect } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { containers } from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import { bytesToBase64 } from "@tearleads/encoding";
import { ContainerMutationResponseSchema } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import { routeApp } from "../../src/routeApp";
import { parseOrganizationAuthorityDescriptor } from "../../src/workflows/organizations/organizationAuthorityDescriptor";
import { buildPrincipalGrantRefreshRequest } from "./containerGrantRefresh";
import { buildDocumentPurgeRequest } from "./documentPurge";
import {
  accessManifestFromContainerResponse,
  bootstrapRoot,
  createDocument,
  kekStateFromContainerResponse,
} from "./keyingWriterProjectionKit";
import { seedLongPrincipalHistory } from "./longPrincipalHistory";
import { getDefaultOrganizationId } from "./organizationMembership";
import { loadVerifiedPrincipalPolicy } from "./principalPolicy";
import {
  getPolicy,
  registerAndAuthenticate,
} from "./principalPolicyReadFixtures";
import { projectionRouteRequest } from "./projectionRouteHistory";

export async function createLongPurgeHistoryFixture(versions: number) {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const initial = await bootstrapRoot(owner);
  const id = initial.principalPolicies[0]?.principalId;
  if (!id) throw new Error("Missing Admins fixture");
  const policy = await (await getPolicy(owner, "group", id)).json();
  const groupHead = await seedLongPrincipalHistory({
    actor: owner,
    policy,
    throughVersion: versions,
  });
  const organizationId = await getDefaultOrganizationId(owner.userId);
  const organization = await (
    await getPolicy(owner, "organization", organizationId)
  ).json();
  const directory = parseOrganizationAuthorityDescriptor(
    organization.currentPayload.ciphertext,
  );
  if (!directory) throw new Error("Missing directory");
  const groupHeads = directory.groupHeads.map((head) =>
    head.principalId === id
      ? { ...head, version: groupHead.version, stateHash: groupHead.stateHash }
      : head,
  );
  await seedLongPrincipalHistory({
    actor: owner,
    policy: organization,
    throughVersion: versions,
    payloadCiphertext: bytesToBase64(
      new TextEncoder().encode(JSON.stringify({ ...directory, groupHeads })),
    ),
  });
  for (const container of await db
    .select({ id: containers.id })
    .from(containers)
    .where(eq(containers.organizationId, organizationId))) {
    const prepared = await projectionRouteRequest(
      `/containers/${container.id}/writer-projection`,
      owner.token,
    );
    expect(prepared.status, await prepared.clone().text()).toBe(200);
  }
  const refresh = await buildPrincipalGrantRefreshRequest({
    parentKekState: null,
    previous: initial.bundle,
    previousContainerPath: [initial.bundle],
    previousKekState: initial.kekState,
    replacementPrincipalPolicy: await loadVerifiedPrincipalPolicy(
      db,
      "group",
      id,
    ),
    signer: owner,
  });
  const refreshed = await routeApp.request(
    `/containers/${initial.kekState.containerId}/share`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(refresh),
    },
  );
  expect(refreshed.status, await refreshed.clone().text()).toBe(200);
  const refreshedBody = ContainerMutationResponseSchema.parse(
    await refreshed.json(),
  );
  const root = {
    bundle: accessManifestFromContainerResponse(refreshedBody),
    kekState: kekStateFromContainerResponse(refreshedBody),
    principalPolicies: [await loadVerifiedPrincipalPolicy(db, "group", id)],
  };
  const created = await createDocument({ owner, root });
  const request = JSON.stringify(
    await buildDocumentPurgeRequest({
      owner,
      root,
      documentId: created.id,
      documentManifestHash: created.accessManifest.manifestHash,
    }),
  );
  return {
    owner,
    organizationId,
    groupId: id,
    root,
    documentId: created.id,
    request,
  };
}
