import { expect, test } from "bun:test";
import { createNativeTestExecSql } from "@tearleads/test-utils";
import {
  createOrganizationHistoryFixture,
  policySnapshot,
} from "../../../test/helpers/organizationPolicyHistory";
import {
  principalPolicyHead,
  signedPrincipalPolicyBundle,
} from "../../../test/helpers/principalPolicyFixtures";
import { loadPrincipalPolicyCheckpoint } from "../persistence/keyingCheckpointPersistence";
import {
  encodeOrganizationAuthorityDescriptor,
  parseOrganizationAuthorityDescriptor,
} from "../principals/organizationAuthorityDescriptor";
import { verifyProjectionPolicyEvidence } from "./projectionPolicyEvidence";

for (const historical of [false, true]) {
  test(`organization evidence rejects an outsider's externally authorized ${historical ? "predecessor" : "head"}`, async () => {
    const owner = await createOrganizationHistoryFixture();
    const attacker = await createOrganizationHistoryFixture();
    const authority = await attacker.createGroup("Attacker authority");
    const previous = owner.afterDeletion;
    const descriptor = parseOrganizationAuthorityDescriptor(
      previous.currentPayload.ciphertext,
    );
    const authorityHead = {
      ...principalPolicyHead(authority),
      principalType: "group" as const,
    };
    // The attacker owns a real, independently signed group. Their successor
    // extends the honest pinned organization chain and binds that group in a
    // newly signed directory, but they were never an organization admin.
    const forged = await signedPrincipalPolicyBundle({
      memberEnvelopes: previous.currentMemberEnvelopes.envelopes,
      payloadCiphertext: encodeOrganizationAuthorityDescriptor({
        ...descriptor,
        groupHeads: [...descriptor.groupHeads, authorityHead],
      }),
      projection: previous.currentProjection,
      previousStates: [
        ...previous.previousStates,
        {
          state: previous.currentState,
          projection: previous.currentProjection,
          grants: previous.currentGrants,
        },
      ],
      signing: {
        ...previous.currentState,
        version: previous.currentState.version + 1,
        prevStateHash: previous.currentState.stateHash,
        externalAuthority: authorityHead,
        signerUserId: attacker.signerUserId,
        signerUserKeyFingerprint:
          authority.currentState.signerUserKeyFingerprint,
      },
      signingPrivateKey: attacker.signingKeyPair.signingPrivateKey,
    });
    const head = historical
      ? await owner.advanceDirectory(forged, null)
      : forged;
    const evidence = {
      ...owner.evidence(true),
      organization: policySnapshot(previous),
    };
    const { close, execSql } = createNativeTestExecSql();
    try {
      const input = {
        evidence,
        execSql,
        organizationId: owner.organizationId,
        resolveUserKey: async (userId: string) =>
          (await owner.resolveTrustedUserIdentity(userId)) ??
          attacker.resolveTrustedUserIdentity(userId),
      };
      await verifyProjectionPolicyEvidence(input);
      await loadPrincipalPolicyCheckpoint(
        execSql,
        "organization",
        owner.organizationId,
      );
      await execSql(
        `INSERT INTO principal_policy_checkpoints
          (principal_type, principal_id, version, state_hash, updated_at)
          VALUES (?, ?, ?, ?, ?)`,
        [
          "organization",
          owner.organizationId,
          previous.currentState.version,
          previous.currentState.stateHash,
          previous.currentState.signedAt,
        ],
      );
      evidence.organization = policySnapshot(head);
      evidence.organizationPayloads.push(forged.currentPayload);
      if (historical) evidence.organizationPayloads.push(head.currentPayload);
      evidence.groups.push(policySnapshot(authority));
      await expect(verifyProjectionPolicyEvidence(input)).rejects.toThrow(
        "organization states cannot cite external authority",
      );
      expect(
        await loadPrincipalPolicyCheckpoint(
          execSql,
          "organization",
          owner.organizationId,
        ),
      ).toMatchObject({ stateHash: previous.currentState.stateHash });
    } finally {
      close();
    }
  });
}
