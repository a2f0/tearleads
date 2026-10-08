import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { createHistoricalPolicyPurgeFixture } from "../../../test/helpers/documentPurgeHistoricalPolicy";
import { loadPrincipalPolicyCheckpoint } from "../persistence/keyingCheckpointPersistence";
import {
  encodeOrganizationAuthorityDescriptor,
  parseOrganizationAuthorityDescriptor,
} from "../principals/organizationAuthorityDescriptor";
import { verifyDocumentPurgeProof } from "./documentPurgeProofVerification";

test("purge uses authority already verified during paging when the directory binds a newer Admins head", async () => {
  const database = await createTestExecSql(
    "purge-historical-external-authority",
  );
  const fixture = await createHistoricalPolicyPurgeFixture(true);
  try {
    const verified = await verifyDocumentPurgeProof({
      execSql: database.execSql,
      expectedDocumentId: fixture.proof.documentId,
      expectedOrganizationId: "organization-1",
      proof: fixture.proof,
      resolveUserKey: fixture.resolveUserKey,
      warmReferencedPrincipalPolicies: fixture.warmer(database.execSql),
    });
    await verified.commitCheckpoints();
    const admins = fixture.proof.policyEvidence.groups.find(
      ({ head }) => head.version === 2,
    );
    if (!admins) throw new Error("Missing newer Admins source");
    expect(
      await loadPrincipalPolicyCheckpoint(
        database.execSql,
        "group",
        admins.head.principalId,
      ),
    ).toMatchObject({ version: 2, stateHash: admins.head.stateHash });
  } finally {
    database.close();
  }
});

test("an unsigned directory payload cannot add an unrelated Admins identity to purge evidence", async () => {
  const database = await createTestExecSql(
    "purge-tampered-directory-authority",
  );
  const fixture = await createHistoricalPolicyPurgeFixture();
  const input = {
    execSql: database.execSql,
    expectedDocumentId: fixture.proof.documentId,
    expectedOrganizationId: "organization-1",
    proof: fixture.proof,
    resolveUserKey: fixture.resolveUserKey,
    warmReferencedPrincipalPolicies: fixture.warmer(database.execSql),
  };
  try {
    await verifyDocumentPurgeProof(input);
    const proof = structuredClone(fixture.proof);
    const directoryPayload = proof.policyEvidence.organizationPayloads[0];
    if (!directoryPayload) throw new Error("Missing organization payload");
    const directory = parseOrganizationAuthorityDescriptor(
      directoryPayload.payload.ciphertext,
    );
    const admins = directory.groupHeads.find(
      ({ principalId }) => principalId === directory.adminGroupId,
    );
    if (!admins) throw new Error("Missing Admins head");
    const injectedAdmins = { ...admins, principalId: "uncited-admins" };
    directoryPayload.payload.ciphertext = encodeOrganizationAuthorityDescriptor(
      {
        ...directory,
        adminGroupId: injectedAdmins.principalId,
        groupHeads: [...directory.groupHeads, injectedAdmins],
      },
    );
    await expect(
      verifyDocumentPurgeProof({ ...input, proof }),
    ).rejects.toMatchObject({
      code: "object_mismatch",
      message:
        "Public projection history: directory payload differs from its signed hash",
    });
    expect(
      await loadPrincipalPolicyCheckpoint(
        database.execSql,
        "group",
        injectedAdmins.principalId,
      ),
    ).toBeNull();
  } finally {
    database.close();
  }
});
