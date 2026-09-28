import { expect, test } from "bun:test";
import type {
  AccessObjectKind,
  AnyVerifiedAccessManifest,
  ManagedPrincipalKind,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import { advanceKeyingCheckpointsAtomically } from "../../data/persistence/keyingCheckpointAdvancePersistence";
import {
  loadAccessManifestCheckpoint,
  loadPrincipalPolicyCheckpoint,
} from "../../data/persistence/keyingCheckpointPersistence";
import { clearRemoteSyncState } from "./remoteReset";

const OLD_ORG = "old-organization";
const NEW_ORG = "new-organization";
const ORIGINAL = "a".repeat(64);
const FORK = "b".repeat(64);

// These doubles enter at the post-signature checkpoint boundary. The regression
// is whether a reset discards the durable comparison, not signature checking.
function accessEvidence(
  objectKind: AccessObjectKind,
  organizationId: string,
  epoch: number,
  manifestHash: string,
): AnyVerifiedAccessManifest {
  return {
    checkpoint: {
      objectKind,
      objectId: "same-object-id",
      organizationId,
      epoch,
      manifestHash,
    },
    manifest: { previousManifestHash: epoch === 1 ? null : ORIGINAL },
    manifestHash,
  } as unknown as AnyVerifiedAccessManifest;
}

function policyEvidence(
  principalType: ManagedPrincipalKind,
  version: number,
  stateHash: string,
): VerifiedPrincipalPolicy {
  const checkpoint = {
    principalType,
    principalId: principalType === "organization" ? OLD_ORG : "old-group",
    version,
    stateHash,
  };
  return {
    ...checkpoint,
    checkpoint,
    state: checkpoint,
    history: [],
  } as unknown as VerifiedPrincipalPolicy;
}

for (const attack of ["rollback", "equivocation"] as const) {
  test.each(["container", "document"] as const)(
    `reset retains %s checkpoint protection against ${attack}`,
    async (objectKind) => {
      const { close, execSql } = await createTestExecSql("reset-access-pins");
      const head = accessEvidence(objectKind, OLD_ORG, 2, ORIGINAL);
      const advance = (candidate: AnyVerifiedAccessManifest) =>
        advanceKeyingCheckpointsAtomically({
          execSql,
          policies: [],
          access: [{ head: candidate, predecessors: [] }],
        });
      try {
        await advance(head);
        await clearRemoteSyncState(execSql, { organizationId: OLD_ORG });
        await expect(
          advance(
            accessEvidence(
              objectKind,
              OLD_ORG,
              attack === "rollback" ? 1 : 2,
              FORK,
            ),
          ),
        ).rejects.toMatchObject({ code: attack });
        await clearRemoteSyncState(execSql, {
          organizationId: OLD_ORG,
          replacement: { organizationId: NEW_ORG, rootContainerId: "new-root" },
        });
        await expect(
          advance(
            accessEvidence(
              objectKind,
              OLD_ORG,
              attack === "rollback" ? 1 : 2,
              FORK,
            ),
          ),
        ).rejects.toMatchObject({ code: attack });
        expect(
          await loadAccessManifestCheckpoint(
            execSql,
            objectKind,
            OLD_ORG,
            "same-object-id",
          ),
        ).toEqual(head.checkpoint);

        // A fresh organization has a distinct checkpoint namespace even when
        // recovery reuses a local container UUID.
        const replacement = accessEvidence(objectKind, NEW_ORG, 1, FORK);
        await advance(replacement);
        expect(
          await loadAccessManifestCheckpoint(
            execSql,
            objectKind,
            NEW_ORG,
            "same-object-id",
          ),
        ).toEqual(replacement.checkpoint);
      } finally {
        close();
      }
    },
  );

  test.each(["group", "organization"] as const)(
    `reset retains %s checkpoint protection against ${attack}`,
    async (principalType) => {
      const { close, execSql } = await createTestExecSql("reset-policy-pins");
      const head = policyEvidence(principalType, 2, ORIGINAL);
      const advance = (candidate: VerifiedPrincipalPolicy) =>
        advanceKeyingCheckpointsAtomically({
          execSql,
          organizationId: OLD_ORG,
          policies: [candidate],
          access: [],
        });
      try {
        await advance(head);
        await clearRemoteSyncState(execSql, { organizationId: OLD_ORG });
        await expect(
          advance(
            policyEvidence(principalType, attack === "rollback" ? 1 : 2, FORK),
          ),
        ).rejects.toMatchObject({ code: attack });
        // Retained group pins must retain their ownership too, so a subsequent
        // reset still knows which organization owns the policy evidence.
        await clearRemoteSyncState(execSql, {
          organizationId: OLD_ORG,
          replacement: { organizationId: NEW_ORG, rootContainerId: "new-root" },
        });
        await expect(
          advance(
            policyEvidence(principalType, attack === "rollback" ? 1 : 2, FORK),
          ),
        ).rejects.toMatchObject({ code: attack });
        expect(
          await loadPrincipalPolicyCheckpoint(
            execSql,
            principalType,
            head.principalId,
          ),
        ).toEqual(head.checkpoint);
      } finally {
        close();
      }
    },
  );
}
