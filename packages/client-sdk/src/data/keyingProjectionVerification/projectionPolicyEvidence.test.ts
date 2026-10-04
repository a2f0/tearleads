import { expect, test } from "bun:test";
import { computePrincipalStatePayloadCiphertextHash } from "@tearleads/crypto";
import { createNativeTestExecSql } from "@tearleads/test-utils";
import {
  createOrganizationHistoryFixture,
  policySnapshot,
} from "../../../test/helpers/organizationPolicyHistory";
import { loadPrincipalPolicyCheckpoint } from "../persistence/keyingCheckpointPersistence";
import { loadOrganizationFounder } from "../persistence/organizationFounderPersistence";
import {
  encodeOrganizationAuthorityDescriptor,
  parseOrganizationAuthorityDescriptor,
} from "../principals/organizationAuthorityDescriptor";
import { verifyProjectionPolicyEvidence } from "./projectionPolicyEvidence";

async function fixture() {
  const data = await createOrganizationHistoryFixture();
  const history = data.evidence(true);
  return {
    data,
    input: {
      organizationId: data.organizationId,
      resolveUserKey: data.resolveTrustedUserIdentity,
      evidence: {
        organization: policySnapshot(data.afterDeletion),
        organizationPayloads: history.organizationPayloads,
        groups: history.groups,
      },
    },
  };
}

test("deleted group evidence verifies without advancing current-policy checkpoints", async () => {
  const { data, input } = await fixture();
  const { close, execSql } = createNativeTestExecSql();
  try {
    const policies = await verifyProjectionPolicyEvidence({
      ...input,
      execSql,
    });
    expect(
      policies.some(
        (policy) => policy.stateHash === data.added.currentState.stateHash,
      ),
    ).toBe(true);
    expect(
      await loadPrincipalPolicyCheckpoint(
        execSql,
        "group",
        data.added.currentState.principalId,
      ),
    ).toBeNull();
    expect(JSON.stringify(input.evidence)).not.toContain(
      "currentMemberEnvelopes",
    );
    expect(JSON.stringify(input.evidence)).not.toContain("currentPayload");
    // Directory signatures alone do not bind the founder to a held root.
    expect(
      await loadOrganizationFounder(execSql, data.organizationId),
    ).toBeNull();
  } finally {
    close();
  }
});

test("directory payload tampering is refused even with a recomputed advertised hash", async () => {
  const { input } = await fixture();
  const payload = input.evidence.organizationPayloads[1];
  if (!payload) throw new Error("Expected historical directory");
  const descriptor = parseOrganizationAuthorityDescriptor(payload.ciphertext);
  payload.ciphertext = encodeOrganizationAuthorityDescriptor({
    ...descriptor,
    groupHeads: descriptor.groupHeads.filter(
      (head) =>
        head.principalId === descriptor.adminGroupId ||
        head.principalId === descriptor.memberGroupId,
    ),
  });
  payload.ciphertextHash = await computePrincipalStatePayloadCiphertextHash(
    payload.ciphertext,
  );
  const { close, execSql } = createNativeTestExecSql();
  try {
    await expect(
      verifyProjectionPolicyEvidence({ ...input, execSql }),
    ).rejects.toThrow("signed hash");
  } finally {
    close();
  }
});

test("a correctly signed group outside the organization directory is refused", async () => {
  const { data, input } = await fixture();
  input.evidence.groups.push(
    policySnapshot(await data.createGroup("Unbound group")),
  );
  const { close, execSql } = createNativeTestExecSql();
  try {
    await expect(
      verifyProjectionPolicyEvidence({ ...input, execSql }),
    ).rejects.toThrow("absent from signed directory");
  } finally {
    close();
  }
});

test("a signed directory from another organization is refused", async () => {
  const { input } = await fixture();
  const { close, execSql } = createNativeTestExecSql();
  try {
    await expect(
      verifyProjectionPolicyEvidence({
        ...input,
        execSql,
        organizationId: "other",
      }),
    ).rejects.toThrow("principal scope");
  } finally {
    close();
  }
});

for (const malformed of ["missing", "duplicate"] as const) {
  test(`${malformed} signed directory payloads are refused`, async () => {
    const { data, input } = await fixture();
    const [first] = input.evidence.organizationPayloads;
    if (!first) throw new Error("Expected directory history");
    if (malformed === "missing")
      input.evidence.organizationPayloads =
        input.evidence.organizationPayloads.filter(
          (payload) =>
            payload.stateHash !== data.afterAddition.currentState.stateHash,
        );
    else input.evidence.organizationPayloads.push(first);
    const { close, execSql } = createNativeTestExecSql();
    try {
      await expect(
        verifyProjectionPolicyEvidence({ ...input, execSql }),
      ).rejects.toThrow(
        malformed === "missing" ? "absent from signed directory" : "scope",
      );
    } finally {
      close();
    }
  });
}

for (const fork of [false, true]) {
  test(`historical proof ${fork ? "refuses a fork of" : "connects without advancing"} a durable group pin`, async () => {
    const { data, input } = await fixture();
    const state = data.created.currentState;
    const { close, execSql } = createNativeTestExecSql();
    try {
      // Reuse memoized signatures after the durable trust anchor changes.
      await verifyProjectionPolicyEvidence({ ...input, execSql });
      await loadPrincipalPolicyCheckpoint(execSql, "group", state.principalId);
      const stateHash = fork ? "f".repeat(64) : state.stateHash;
      await execSql(
        `INSERT INTO principal_policy_checkpoints
          (principal_type, principal_id, version, state_hash, updated_at)
          VALUES (?, ?, ?, ?, ?)`,
        [
          "group",
          state.principalId,
          state.version,
          stateHash,
          "2026-09-26T00:00:00.000Z",
        ],
      );
      const verification = verifyProjectionPolicyEvidence({
        ...input,
        execSql,
      });
      if (fork)
        await expect(verification).rejects.toThrow(
          "does not extend the local checkpoint",
        );
      else
        expect(
          (await verification).some(
            (policy) => policy.stateHash === data.added.currentState.stateHash,
          ),
        ).toBe(true);
      expect(
        await loadPrincipalPolicyCheckpoint(
          execSql,
          "group",
          state.principalId,
        ),
      ).toMatchObject({ version: state.version, stateHash });
    } finally {
      close();
    }
  });
}

test("a directory-bound group cannot use an authority other than the organization's Admins", async () => {
  const { data, input } = await fixture();
  const other = await data.createGroup("Other authority");
  const dependent = await data.createGroup("Wrong authority", false, other);
  const withOther = await data.advanceDirectory(data.afterDeletion, other);
  const withDependent = await data.advanceDirectory(withOther, dependent);
  input.evidence.organization = policySnapshot(withDependent);
  input.evidence.organizationPayloads.push(
    withOther.currentPayload,
    withDependent.currentPayload,
  );
  input.evidence.groups.push(policySnapshot(other), policySnapshot(dependent));
  const { close, execSql } = createNativeTestExecSql();
  try {
    await expect(
      verifyProjectionPolicyEvidence({ ...input, execSql }),
    ).rejects.toThrow("not the organization's Admins");
  } finally {
    close();
  }
});

test("unrelated directory payloads can be omitted while the signed chain remains complete", async () => {
  const { data, input } = await fixture();
  input.evidence.organizationPayloads = [data.afterAddition.currentPayload];
  const { close, execSql } = createNativeTestExecSql();
  try {
    expect(
      (await verifyProjectionPolicyEvidence({ ...input, execSql })).length,
    ).toBe(4);
  } finally {
    close();
  }
});
