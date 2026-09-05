import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  accessManifestHeads,
  containerKeyEpochs,
  containerKeyWraps,
  organizationBilling,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import {
  buildMaterializedDocumentCreatePlan,
  cacheReferencedPrincipalPolicies,
} from "@tearleads/client-sdk";
import { createTestTrustedUserIdentityResolver } from "@tearleads/client-sdk/testing";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  isContainerMutationResponse,
  isContainerReciteResponse,
  isContainerWriterProjectionResponse,
  isOrganizationReadModelResponse,
  isPrincipalPolicyBundleResponse,
} from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import { authenticate } from "../../../test/helpers/authenticate";
import { buildRootGrantRequest } from "../../../test/helpers/containerGrantMutation";
import {
  postRecite as post,
  buildReciteRequest as request,
  createReciteScenario as scenario,
} from "../../../test/helpers/containerRecite";
import { setTestOrganizationBillingLocal } from "../../../test/helpers/organizationBilling";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";

test.each([
  "billing_inactive",
  "sync_seat_unassigned",
] as const)("recitation refuses %s without advancing the head", async (reason) => {
  const { owner, root, child } = await scenario();
  const organizationId = child.organizationId;
  const signed = await request({
    path: [root.bundle, child.accessManifest],
    signer: owner,
  });
  await setTestOrganizationBillingLocal(organizationId);
  if (reason === "sync_seat_unassigned") {
    await db
      .update(organizationBilling)
      .set({
        currentPeriodEndsAt: new Date("2099-01-01T00:00:00.000Z"),
        currentPeriodStartsAt: new Date("2098-12-01T00:00:00.000Z"),
        seatCount: 1,
        status: "active",
      })
      .where(eq(organizationBilling.organizationId, organizationId));
  }
  const response = await post(child.containerId, owner, signed);
  expect(response.status).toBe(402);
  expect(await response.json()).toMatchObject({ organizationId, reason });
  expect(
    await db
      .select({ manifestHash: accessManifestHeads.manifestHash })
      .from(accessManifestHeads)
      .where(eq(accessManifestHeads.objectId, child.containerId)),
  ).toEqual([{ manifestHash: child.accessManifest.manifestHash }]);
});

test("re-citing an empty child advances its manifest and preserves every KEK row", async () => {
  const { owner, root, child } = await scenario();
  const path = [root.bundle, child.accessManifest];
  const epochsBefore = await db
    .select()
    .from(containerKeyEpochs)
    .where(eq(containerKeyEpochs.containerId, child.containerId));
  const loadWraps = () =>
    db
      .select()
      .from(containerKeyWraps)
      .where(
        eq(
          containerKeyWraps.containerKeyEpochId,
          child.containerKek.containerKeyEpochId,
        ),
      );
  const wrapsBefore = await loadWraps();
  const signed = await request({ path, signer: owner });
  const response = await post(child.containerId, owner, signed);
  expect(response.status, await response.clone().text()).toBe(200);
  const body: unknown = await response.json();
  if (!isContainerReciteResponse(body))
    throw new Error("Expected recite response");
  expect(body.accessManifest.manifestHash).toBe(signed.expectedManifestHash);
  expect(body.accessManifest.state).toMatchObject({
    directGrants: [],
    containerKeyEpochId: child.containerKek.containerKeyEpochId,
  });
  expect(
    await db
      .select()
      .from(containerKeyEpochs)
      .where(eq(containerKeyEpochs.containerId, child.containerId)),
  ).toEqual(epochsBefore);
  expect(await loadWraps()).toEqual(wrapsBefore);
  const projectionResponse = await routeApp.request(
    `/containers/${child.containerId}/writer-projection`,
    {
      headers: { Authorization: `Bearer ${owner.token}` },
    },
  );
  expect(
    projectionResponse.status,
    await projectionResponse.clone().text(),
  ).toBe(200);
  const projection: unknown = await projectionResponse.json();
  if (!isContainerWriterProjectionResponse(projection))
    throw new Error("Expected projection");
  expect(projection.path.at(-1)?.manifestHash).toBe(
    signed.expectedManifestHash,
  );
  const replay = await post(child.containerId, owner, signed);
  expect(replay.status).toBe(409);
});

test("recitation rejects missing ancestor citations and changed key epochs", async () => {
  const { owner, root, child } = await scenario();
  const signed = await request({
    path: [root.bundle, child.accessManifest],
    signer: owner,
  });
  expect(
    (
      await post(child.containerId, owner, {
        ...signed,
        previousContainerPath: [],
      })
    ).status,
  ).toBe(400);
  const truncated = await post(child.containerId, owner, {
    ...signed,
    previousContainerPath: signed.previousContainerPath.slice(1),
  });
  expect(truncated.status, await truncated.clone().text()).toBe(409);
  for (const options of [
    { omitAncestor: true },
    { keyEpochId: "changed-key" },
  ]) {
    const response = await post(
      child.containerId,
      owner,
      await request({
        ...options,
        path: [root.bundle, child.accessManifest],
        signer: owner,
      }),
    );
    expect(response.status, await response.clone().text()).toBe(409);
  }
});

test("a signer without inherited admin authority cannot recite a child", async () => {
  const { root, child } = await scenario();
  const stranger = createTestUser();
  await registerUser(stranger);
  await authenticate(stranger);
  const response = await post(
    child.containerId,
    stranger,
    await request({
      path: [root.bundle, child.accessManifest],
      signer: stranger,
    }),
  );
  expect(response.status, await response.clone().text()).toBe(403);
});

test("an inherited write grant does not authorize re-citation", async () => {
  const { owner, root, child } = await scenario();
  const writer = createTestUser();
  await registerUser(writer);
  await authenticate(writer);
  const grant = await buildRootGrantRequest({
    accessLevel: "write",
    previous: root.bundle,
    previousKekState: root.kekState,
    recipient: writer,
    signer: owner,
  });
  const granted = await routeApp.request(
    `/containers/${root.kekState.containerId}/share`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(grant),
    },
  );
  expect(granted.status, await granted.clone().text()).toBe(200);
  const response: unknown = await granted.json();
  if (!isContainerMutationResponse(response))
    throw new Error("Expected granted root");
  const recited = await post(
    child.containerId,
    writer,
    await request({
      path: [response.accessManifest, child.accessManifest],
      signer: writer,
    }),
  );
  expect(recited.status, await recited.clone().text()).toBe(403);
  expect(await recited.text()).toContain("admin");
});

test("a child re-cites an advanced ancestor and rejects the old authorizing path", async () => {
  const { owner, root, child } = await scenario();
  const rootResponse = await post(
    root.kekState.containerId,
    owner,
    await request({ path: [root.bundle], signer: owner }),
  );
  expect(rootResponse.status).toBe(200);
  const advanced: unknown = await rootResponse.json();
  if (!isContainerReciteResponse(advanced))
    throw new Error("Expected advanced root");
  const stale = await post(
    child.containerId,
    owner,
    await request({
      path: [root.bundle, child.accessManifest],
      signer: owner,
    }),
  );
  expect(stale.status).toBe(409);
  const current = await post(
    child.containerId,
    owner,
    await request({
      path: [advanced.accessManifest, child.accessManifest],
      signer: owner,
    }),
  );
  expect(current.status, await current.clone().text()).toBe(200);
});

test("the SDK verifies and unwraps an API recitation without new KEK material", async () => {
  const { owner, root } = await scenario();
  const readModelPath = `/organizations/${Reflect.get(root.bundle.state, "organizationId")}/read-model`;
  const headers = { Authorization: `Bearer ${owner.token}` };
  const beforeResponse = await routeApp.request(readModelPath, { headers });
  const before: unknown = await beforeResponse.json();
  if (!isOrganizationReadModelResponse(before) || before.mode !== "snapshot")
    throw new Error("Expected organization snapshot");
  const signed = await request({ path: [root.bundle], signer: owner });
  const response = await post(root.kekState.containerId, owner, signed);
  expect(response.status, await response.clone().text()).toBe(200);
  // Observe immediately after this single committed request, without relying
  // on another descendant request or a background pass completion signal.
  const query = new URLSearchParams({ cursor: before.nextCursor });
  const afterResponse = await routeApp.request(`${readModelPath}?${query}`, {
    headers,
  });
  const after: unknown = await afterResponse.json();
  if (!isOrganizationReadModelResponse(after) || after.mode !== "delta")
    throw new Error("Expected organization delta");
  const grants = after.lanes.grants?.grants.filter(
    (grant) => grant.containerId === root.kekState.containerId,
  );
  expect(grants?.length).toBeGreaterThan(0);
  expect(
    grants?.every(
      (grant) => grant.metadataAccessStateHash === signed.expectedManifestHash,
    ),
  ).toBe(true);
  const projectionResponse = await routeApp.request(
    `/containers/${root.kekState.containerId}/writer-projection`,
    { headers: { Authorization: `Bearer ${owner.token}` } },
  );
  expect(projectionResponse.status).toBe(200);
  const projection: unknown = await projectionResponse.json();
  if (!isContainerWriterProjectionResponse(projection))
    throw new Error("Expected projection");
  const database = await createTestExecSql("api-recited-projection-sdk");
  try {
    const resolveUser = createTestTrustedUserIdentityResolver({
      encapsulationPublicKey: owner.kem.publicKey,
      signingKeyFingerprint: owner.fingerprint,
      signingPublicKey: owner.signing.signingPublicKey,
      userId: owner.userId,
    });
    const materialized = await buildMaterializedDocumentCreatePlan({
      author: {
        organizationId: projection.organizationId,
        signerDeviceId: `signing-key:${owner.fingerprint}`,
        signerKeyFingerprint: owner.fingerprint,
        signerPrivateKey: owner.signing.signingPrivateKey,
        signerUserId: owner.userId,
      },
      containerProjection: projection,
      execSql: database.execSql,
      resolveProjectionUserKey: resolveUser,
      targetSecretKey: owner.kem.secretKey,
      warmReferencedPrincipalPolicies: (input) =>
        cacheReferencedPrincipalPolicies({
          ...input,
          execSql: database.execSql,
          getCurrentPrincipalPolicy: async (type, id) => {
            const response = await routeApp.request(
              `/principals/${type}/${id}/policy`,
              {
                headers: { Authorization: `Bearer ${owner.token}` },
              },
            );
            expect(response.status).toBe(200);
            const bundle: unknown = await response.json();
            if (!isPrincipalPolicyBundleResponse(bundle))
              throw new Error("Expected policy bundle");
            return bundle;
          },
          reportSecurityIncident: async (error) => {
            throw error;
          },
          resolveTrustedUserIdentity: resolveUser,
        }),
    });
    expect(
      materialized.plan.request.targetContainerPathRefs?.at(-1)?.manifestHash,
    ).toBe(signed.expectedManifestHash);
  } finally {
    database.close();
  }
});
