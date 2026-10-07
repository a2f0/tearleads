import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { createTestUser } from "@tearleads/bob-and-alice";
import {
  buildMaterializedContainerRekeyPlan,
  cacheReferencedPrincipalPolicies,
} from "@tearleads/client-sdk";
import { bytesToBase64 } from "@tearleads/encoding";
import { PrincipalPolicyBundleResponseSchema } from "@tearleads/validators/response";
import { createAncestorSdkContext } from "../../../test/helpers/ancestorSdkRepair";
import { bootstrapRoot } from "../../../test/helpers/keyingWriterProjectionKit";
import { createSignedPrincipalState } from "../../../test/helpers/principalPolicy";
import {
  getPolicy,
  registerAndAuthenticate,
} from "../../../test/helpers/principalPolicyReadFixtures";
import {
  signPrincipalStateBundle,
  storePrincipalState,
} from "../../../test/helpers/principalState";
import { withProjectionHistoryRecovery } from "../../../test/helpers/projectionHistoryRecovery";
import { recoverRegisteredRootKek } from "../../../test/helpers/registeredRootKek";
import { replaceCurrentPrincipalMemberEnvelopesInTransaction } from "../../access/write/principalMemberEnvelopes";
import { parseOrganizationAuthorityDescriptor } from "../../workflows/organizations/organizationAuthorityDescriptor";

// Exercise the actual loader and cold SDK at substantially more than the app's
// two-group fixture. Byte/count bounds are stable; timings are diagnostic only.
test("historical proofs scale across 64 groups and 128 directory successors", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await recoverRegisteredRootKek({
    owner,
    root: await bootstrapRoot(owner),
  });
  const organizationId = Reflect.get(root.bundle.manifest, "organizationId");
  if (typeof organizationId !== "string")
    throw new Error("Missing organization");
  const organization = PrincipalPolicyBundleResponseSchema.parse(
    await (await getPolicy(owner, "organization", organizationId)).json(),
  );
  const descriptor = parseOrganizationAuthorityDescriptor(
    organization.currentPayload.ciphertext,
  );
  if (!descriptor) throw new Error("Missing signed directory");
  const groupHeads = [...descriptor.groupHeads];
  for (let index = 0; index < 64; index += 1) {
    const bundle = await createSignedPrincipalState({
      principalType: "group",
      principalId: crypto.randomUUID(),
      members: [],
      signerUserId: owner.userId,
      signerUserKeyFingerprint: owner.fingerprint,
      signingPrivateKey: owner.signing.signingPrivateKey,
    });
    const state = await storePrincipalState(bundle, db);
    groupHeads.push({
      principalType: "group",
      principalId: state.principalId,
      version: state.version,
      keyEpoch: state.keyEpoch,
      stateHash: state.stateHash,
      keyFingerprint: state.keyFingerprint,
    });
  }
  const payloadCiphertext = bytesToBase64(
    new TextEncoder().encode(JSON.stringify({ ...descriptor, groupHeads })),
  );
  let previous = organization.currentState;
  let halfBytes = 0;
  const samples: object[] = [];
  for (let index = 1; index <= 128; index += 1) {
    const successor = await signPrincipalStateBundle({
      ...previous,
      version: previous.version + 1,
      prevStateHash: previous.stateHash,
      payloadCiphertext,
      members: organization.currentProjection.map(({ userId }) => ({ userId })),
      projection: organization.currentProjection,
      grants: organization.currentGrants,
      memberEnvelopes: organization.currentMemberEnvelopes.envelopes,
      signingPrivateKey: owner.signing.signingPrivateKey,
    });
    const stored = await storePrincipalState(successor, db);
    await db.transaction((tx) =>
      replaceCurrentPrincipalMemberEnvelopesInTransaction(
        {
          principalType: "organization",
          principalId: organizationId,
          stateHash: stored.stateHash,
          envelopes: organization.currentMemberEnvelopes.envelopes,
        },
        tx,
      ),
    );
    previous = { ...previous, ...successor.state, stateHash: stored.stateHash };
    if (index !== 64 && index !== 128) continue;
    const cold = await createAncestorSdkContext(owner, organizationId);
    try {
      const start = performance.now();
      const projection =
        await cold.common.apiClient.getContainerWriterProjection(
          root.kekState.containerId,
        );
      const servedAt = performance.now();
      if (!projection) throw new Error("Missing projection");
      const bytes = new TextEncoder().encode(
        JSON.stringify(projection.policyEvidence),
      ).byteLength;
      expect(projection.policyEvidence.organizationPayloads).toHaveLength(1);
      expect(projection.policyEvidence.organization?.head.version).toBe(
        organization.currentState.version + index,
      );
      expect(projection.policyEvidence.groups).toHaveLength(1); // Only cited Admins, not all 66 groups.
      expect(bytes).toBeLessThan(40_000);
      if (index === 64) halfBytes = bytes;
      else expect(bytes).toBeLessThan(halfBytes * 1.05);
      await buildMaterializedContainerRekeyPlan({
        ...cold.common,
        previousProjection: projection,
        warmReferencedPrincipalPolicies: withProjectionHistoryRecovery({
          apiClient: cold.common.apiClient,
          execSql: cold.execSql,
          resolveTrustedUserIdentity: cold.resolveTrustedUserIdentity,
          warmer: (request) =>
            cacheReferencedPrincipalPolicies({
              ...request,
              execSql: cold.execSql,
              getCurrentPrincipalPolicy:
                cold.common.apiClient.getCurrentPrincipalPolicy,
              resolveTrustedUserIdentity: cold.resolveTrustedUserIdentity,
              reportSecurityIncident: async () => undefined,
              log: (message) => {
                throw new Error(message);
              },
            }),
        }),
      });
      const verifiedAt = performance.now();
      const repeated = await cold.common.apiClient.getContainerWriterProjection(
        root.kekState.containerId,
      );
      expect(repeated?.policyEvidence).toEqual(projection.policyEvidence);
      samples.push({
        successors: index,
        groups: groupHeads.length,
        bytes,
        apiMs: Math.round(servedAt - start),
        coldSdkMs: Math.round(verifiedAt - servedAt),
        warmApiMs: Math.round(performance.now() - verifiedAt),
      });
    } finally {
      cold.close();
    }
  }
  console.info("Historical policy load samples", JSON.stringify(samples));
}, 120_000);
