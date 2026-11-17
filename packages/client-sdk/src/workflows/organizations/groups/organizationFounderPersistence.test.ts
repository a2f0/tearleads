import { expect, test } from "bun:test";
import { createNativeTestExecSql } from "@tearleads/test-utils";
import {
  createOrganizationHistoryFixture,
  policySnapshot,
} from "../../../../test/helpers/data/organizationPolicyHistory";
import { organizationPolicyBundleFromInitialRequest } from "../../../../test/helpers/data/principalPolicyFixtures";
import { verifyPrincipalPolicySnapshots } from "../../../../test/helpers/data/principalPolicySnapshotVerification";
import {
  loadOrganizationFounder,
  rememberOrganizationFounder,
} from "../../../data/persistence/organizationFounderPersistence";
import { parseOrganizationAuthorityDescriptor } from "../../../data/principalContracts/organizationAuthorityDescriptor";
import { buildInitialOrganizationPolicyRequest } from "../../../data/principals/organizationPolicyRequest";

test("a different valid genesis cannot overwrite a pinned organization founder", async () => {
  const database = createNativeTestExecSql();
  try {
    const original = await createOrganizationHistoryFixture();
    const foreign = await createOrganizationHistoryFixture();
    const [verifiedOriginal] = await verifyPrincipalPolicySnapshots({
      snapshots: [policySnapshot(original.initial)],
      resolveUserKey: original.resolveTrustedUserIdentity,
    });
    if (!verifiedOriginal) throw new Error("Expected verified genesis");
    await rememberOrganizationFounder({
      execSql: database.execSql,
      organization: verifiedOriginal,
    });
    const held = await loadOrganizationFounder(
      database.execSql,
      original.organizationId,
    );
    const identity = await foreign.resolveTrustedUserIdentity(
      foreign.signerUserId,
    );
    if (!identity) throw new Error("Expected foreign identity");
    const descriptor = parseOrganizationAuthorityDescriptor(
      foreign.initial.currentPayload.ciphertext,
    );
    const request = await buildInitialOrganizationPolicyRequest({
      identityTrustDomain: "https://api.example.test",
      ...descriptor,
      organizationId: original.organizationId,
      encapsulationPublicKey: identity.encapsulationPublicKey,
      signingKeyPair: foreign.signingKeyPair,
      userId: foreign.signerUserId,
    });
    const [substitute] = await verifyPrincipalPolicySnapshots({
      snapshots: [
        policySnapshot(
          await organizationPolicyBundleFromInitialRequest(
            original.organizationId,
            request,
          ),
        ),
      ],
      resolveUserKey: foreign.resolveTrustedUserIdentity,
    });
    if (!substitute) throw new Error("Expected independently valid genesis");
    await expect(
      rememberOrganizationFounder({
        execSql: database.execSql,
        organization: substitute,
      }),
    ).rejects.toMatchObject({ code: "equivocation" });
    expect(
      await loadOrganizationFounder(database.execSql, original.organizationId),
    ).toEqual(held);
  } finally {
    database.close();
  }
});
