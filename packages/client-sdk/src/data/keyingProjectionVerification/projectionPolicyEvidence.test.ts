import { expect, test } from "bun:test";
import { computePrincipalStatePayloadCiphertextHash } from "@tearleads/crypto";
import { createNativeTestExecSql } from "@tearleads/test-utils";
import { createOrganizationHistoryFixture } from "../../../test/helpers/organizationPolicyHistory";
import { principalPolicyHead } from "../../../test/helpers/principalPolicyFixtures";
import {
  projectionDirectoryPayload,
  projectionPolicySource,
  projectionPolicyWarmer,
} from "../../../test/helpers/projectionPolicyHistory";
import { loadPrincipalPolicyCheckpoint } from "../persistence/keyingCheckpointPersistence";
import { loadOrganizationFounder } from "../persistence/organizationFounderPersistence";
import {
  encodeOrganizationAuthorityDescriptor,
  parseOrganizationAuthorityDescriptor,
} from "../principals/organizationAuthorityDescriptor";
import { verifyProjectionPolicyEvidence } from "./projectionPolicyEvidence";

async function fixture() {
  const data = await createOrganizationHistoryFixture();

  return {
    warmer: (
      execSql: Parameters<typeof projectionPolicyWarmer>[0]["execSql"],
    ) =>
      projectionPolicyWarmer({
        execSql,
        bundles: data.projectionBundles,
        resolveUserKey: data.resolveTrustedUserIdentity,
      }),
    data,
    input: {
      organizationId: data.organizationId,
      references: [
        principalPolicyHead(data.created),
        principalPolicyHead(data.added),
      ],
      evidence: data.projectionEvidence(true),
    },
  };
}

test("deleted group evidence verifies without advancing current-policy checkpoints", async () => {
  const { data, input, warmer } = await fixture();
  const { close, execSql } = createNativeTestExecSql();
  try {
    const { policies } = await verifyProjectionPolicyEvidence({
      ...input,
      warmReferencedPrincipalPolicies: warmer(execSql),
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
  const { input, warmer } = await fixture();
  const payload = input.evidence.organizationPayloads[1]?.payload;
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
      verifyProjectionPolicyEvidence({
        ...input,
        warmReferencedPrincipalPolicies: warmer(execSql),
      }),
    ).rejects.toThrow("signed hash");
  } finally {
    close();
  }
});

test("a correctly signed group outside the organization directory is refused", async () => {
  const { data, input, warmer } = await fixture();
  const unbound = await data.createGroup("Unbound group");
  data.projectionBundles.push(unbound);
  input.evidence.groups.push(projectionPolicySource(unbound));
  const { close, execSql } = createNativeTestExecSql();
  try {
    await expect(
      verifyProjectionPolicyEvidence({
        ...input,
        warmReferencedPrincipalPolicies: warmer(execSql),
      }),
    ).rejects.toThrow("lacks its signed directory binding");
  } finally {
    close();
  }
});

test("a signed directory from another organization is refused", async () => {
  const { input, warmer } = await fixture();
  const { close, execSql } = createNativeTestExecSql();
  try {
    await expect(
      verifyProjectionPolicyEvidence({
        ...input,
        warmReferencedPrincipalPolicies: warmer(execSql),
        organizationId: "other",
      }),
    ).rejects.toThrow("outside its scope");
  } finally {
    close();
  }
});

for (const malformed of ["missing", "duplicate"] as const) {
  test(`${malformed} signed directory payloads are refused`, async () => {
    const { data, input, warmer } = await fixture();
    const [first] = input.evidence.organizationPayloads;
    if (!first) throw new Error("Expected directory history");
    if (malformed === "missing")
      input.evidence.organizationPayloads =
        input.evidence.organizationPayloads.filter(
          (payload) =>
            payload.reference.stateHash !==
            data.afterAddition.currentState.stateHash,
        );
    else input.evidence.organizationPayloads.push(first);
    const { close, execSql } = createNativeTestExecSql();
    try {
      await expect(
        verifyProjectionPolicyEvidence({
          ...input,
          warmReferencedPrincipalPolicies: warmer(execSql),
        }),
      ).rejects.toThrow(
        malformed === "missing"
          ? "lacks its signed directory binding"
          : "scope",
      );
    } finally {
      close();
    }
  });
}

for (const fork of [false, true]) {
  test(`historical proof ${fork ? "refuses a fork of" : "connects without advancing"} a durable group pin`, async () => {
    const { data, input, warmer } = await fixture();
    const state = data.created.currentState;
    const { close, execSql } = createNativeTestExecSql();
    try {
      // Reuse memoized signatures after the durable trust anchor changes.
      await verifyProjectionPolicyEvidence({
        ...input,
        warmReferencedPrincipalPolicies: warmer(execSql),
      });
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
        warmReferencedPrincipalPolicies: warmer(execSql),
      });
      if (fork)
        await expect(verification).rejects.toThrow(
          "does not extend the local checkpoint",
        );
      else
        expect(
          (await verification).policies.some(
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
  const { data, input, warmer } = await fixture();
  const other = await data.createGroup("Other authority");
  const dependent = await data.createGroup("Wrong authority", false, other);
  const withOther = await data.advanceDirectory(data.afterDeletion, other);
  const withDependent = await data.advanceDirectory(withOther, dependent);
  data.projectionBundles.push(other, dependent, withOther, withDependent);
  input.evidence.organization = projectionPolicySource(withDependent);
  input.evidence.organizationPayloads.push(
    projectionDirectoryPayload(withOther),
    projectionDirectoryPayload(withDependent),
  );
  input.evidence.groups.push(
    projectionPolicySource(other),
    projectionPolicySource(dependent),
  );
  const { close, execSql } = createNativeTestExecSql();
  try {
    await expect(
      verifyProjectionPolicyEvidence({
        ...input,
        warmReferencedPrincipalPolicies: warmer(execSql),
      }),
    ).rejects.toThrow("authority outside its directory binding");
  } finally {
    close();
  }
});

test("unrelated directory payloads can be omitted while the signed chain remains complete", async () => {
  const { data, input, warmer } = await fixture();
  input.evidence.organizationPayloads = [
    projectionDirectoryPayload(data.afterAddition),
  ];
  const { close, execSql } = createNativeTestExecSql();
  try {
    expect(
      (
        await verifyProjectionPolicyEvidence({
          ...input,
          warmReferencedPrincipalPolicies: warmer(execSql),
        })
      ).policies.length,
    ).toBe(4);
  } finally {
    close();
  }
});
