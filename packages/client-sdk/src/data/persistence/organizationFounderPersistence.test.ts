import { expect, test } from "bun:test";
import { createNativeTestExecSql } from "@tearleads/test-utils";
import {
  createOrganizationHistoryFixture,
  policySnapshot,
} from "../../../test/helpers/organizationPolicyHistory";
import { organizationPolicyBundleFromInitialRequest } from "../../../test/helpers/principalPolicyFixtures";
import { verifyPrincipalPolicySnapshots } from "../../../test/helpers/principalPolicySnapshotVerification";
import { buildInitialOrganizationPolicyRequest } from "../../workflows/registration/registerIdentity";
import { parseOrganizationAuthorityDescriptor } from "../principals/organizationAuthorityDescriptor";
import {
  loadOrganizationFounder,
  rememberOrganizationFounder,
} from "./organizationFounderPersistence";

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
