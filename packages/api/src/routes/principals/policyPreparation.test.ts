import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  principalHistoryIndexNodes,
  principalHistoryProgress,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import { clearPrincipalPolicySignatureCaches } from "@tearleads/crypto/principal-policy-test-fixtures";
import {
  getPrincipalPolicyOperation,
  putPrincipalPolicyOperation,
} from "@tearleads/validators/operation";
import { PrincipalPolicyBundleResponseSchema } from "@tearleads/validators/response";
import {
  asVerifiedContainerManifest,
  bootstrapRoot,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { seedLongPrincipalHistory } from "../../../test/helpers/longPrincipalHistory";
import {
  getPolicy,
  registerAndAuthenticate,
} from "../../../test/helpers/principalPolicyReadFixtures";
import { signPrincipalStateBundle } from "../../../test/helpers/principalState";
import { getCurrentPrincipalState } from "../../access/read/principalStateStore";
import { routeApp } from "../../routeApp";
import { clearProjectionDirectoryBindingsCache } from "../../workflows/principals/projectionDirectoryBindings";
import { clearStoredPolicySnapshotCache } from "../../workflows/principals/snapshotVerificationCache";

for (const method of ["GET", "PUT"] as const) {
  test(`${method} policy prepares outside the transaction and eventually succeeds`, async () => {
    const owner = createTestUser();
    await registerAndAuthenticate(owner);
    const root = await bootstrapRoot(owner);
    const organizationId = asVerifiedContainerManifest(root.bundle).state
      .organizationId;
    const policy = PrincipalPolicyBundleResponseSchema.parse(
      await (await getPolicy(owner, "organization", organizationId)).json(),
    );
    const head = await seedLongPrincipalHistory({
      actor: owner,
      policy,
      throughVersion: 65,
    });
    const successor = await signPrincipalStateBundle({
      ...head,
      version: 66,
      prevStateHash: head.stateHash,
      payloadCiphertext: policy.currentPayload.ciphertext,
      members: policy.currentProjection.map(({ userId }) => ({ userId })),
      projection: policy.currentProjection,
      grants: policy.currentGrants,
      memberEnvelopes: policy.currentMemberEnvelopes.envelopes,
      signingPrivateKey: owner.signing.signingPrivateKey,
    });
    const body =
      method === "PUT"
        ? JSON.stringify({ ...successor, containerMutations: [] })
        : undefined;
    await db.delete(principalHistoryProgress);
    await db.delete(principalHistoryIndexNodes);
    clearPrincipalPolicySignatureCaches();
    clearStoredPolicySnapshotCache();
    clearProjectionDirectoryBindingsCache();
    const progress = new Set<string>();
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const response = await routeApp.request(
        `/principals/organization/${organizationId}/policy`,
        {
          method,
          ...(body === undefined ? {} : { body }),
          headers: {
            Authorization: `Bearer ${owner.token}`,
            "Content-Type": "application/json",
          },
        },
      );
      if (response.status === 202) {
        expect(response.headers.get("Cache-Control")).toBe("no-store");
        const operation =
          method === "GET"
            ? getPrincipalPolicyOperation
            : putPrincipalPolicyOperation;
        const pending = operation.responses[202].parse(await response.json());
        expect(pending.committed).toBe(false);
        expect(progress.has(pending.progressToken)).toBe(false);
        progress.add(pending.progressToken);
        expect(
          (await getCurrentPrincipalState("organization", organizationId, db))
            ?.version,
        ).toBe(65);
        continue;
      }
      expect(response.status, await response.clone().text()).toBe(200);
      const result = PrincipalPolicyBundleResponseSchema.parse(
        await response.json(),
      );
      expect(result.currentState.version).toBe(method === "PUT" ? 66 : 65);
      expect(progress.size).toBeGreaterThan(0);
      return;
    }
    throw new Error("Policy preparation failed to converge");
  }, 30_000);
}
