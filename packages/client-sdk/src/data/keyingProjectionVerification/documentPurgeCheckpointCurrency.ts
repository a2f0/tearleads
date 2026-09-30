import type {
  VerifiedAccessManifestCheckpointEvidence,
  VerifiedPrincipalPolicySnapshot,
} from "@tearleads/crypto";
import type { DocumentPurgeCheckpoint } from "../persistence/documentPurgeCheckpointPersistence";
import { validateAccessManifestCheckpointEvidence } from "../persistence/keyingCheckpointEvidence";
import {
  accessManifestObjectKey,
  loadAccessManifestCheckpoint,
} from "../persistence/keyingCheckpointPersistence";
import { getClientSQLitePersistenceRuntime } from "../sqlite/sqlitePersistenceRuntime";
import { type ExecSql, runSerializedSqlMutation } from "../sqlite/sqlSchema";
import { validateAccessManifestCheckpoints } from "./accessManifestCheckpointEnforcement";
import {
  commitProjectionCheckpoints,
  type ProjectionCheckpointContext,
} from "./checkpointContext";
import { ProjectionDependencyUnavailableError } from "./dependencyUnavailable";
import { enforcePrincipalPolicySnapshotCheckpoints } from "./principalPolicySnapshotVerification";

interface PurgeCheckpointInput {
  readonly context: ProjectionCheckpointContext;
  readonly execSql: ExecSql;
  readonly principalPolicies: readonly VerifiedPrincipalPolicySnapshot[];
}

/** All artifacts must already be authenticated before currency is considered. */
async function currentContainerHeads(input: PurgeCheckpointInput) {
  const current: VerifiedAccessManifestCheckpointEvidence[] = [];
  let superseded = false;
  for (const head of input.context.verifiedHeads) {
    const checkpoint = head.checkpoint;
    const local =
      checkpoint.objectKind === "container"
        ? await loadAccessManifestCheckpoint(
            input.execSql,
            "container",
            checkpoint.organizationId,
            checkpoint.objectId,
          )
        : null;
    if (!local || checkpoint.epoch >= local.epoch) {
      current.push(head);
      continue;
    }
    // A newer head does not order this separately signed purge event. Still
    // reject signed forks visible in the supplied evidence before deferring.
    const key = accessManifestObjectKey(checkpoint);
    validateAccessManifestCheckpointEvidence({
      head,
      localCheckpoint: local,
      predecessors: input.context.verifiedManifests.filter(
        (evidence) =>
          accessManifestObjectKey(evidence.checkpoint) === key &&
          evidence.manifestHash !== head.manifestHash,
      ),
    });
    superseded = true;
  }
  return { current, superseded };
}

async function checkPurgeCheckpointCurrency(
  input: PurgeCheckpointInput,
  documentPurgeCheckpoint?: DocumentPurgeCheckpoint,
): Promise<void> {
  // Keep comparison and optional advancement in the same immediate transaction.
  // Pass the locked executor through nested readers and checkpoint commits.
  await runSerializedSqlMutation(input.execSql, async (execSql) => {
    await getClientSQLitePersistenceRuntime(execSql).transaction(
      async () => {
        const policies = await enforcePrincipalPolicySnapshotCheckpoints({
          execSql,
          policies: input.principalPolicies,
        });
        const { current, superseded } = await currentContainerHeads({
          ...input,
          execSql,
        });
        // An older container must not conceal a document fork, a policy fork, or
        // conflicting current evidence for another container in the same proof.
        await validateAccessManifestCheckpoints({
          execSql,
          policies,
          verifiedHeads: current,
          verifiedManifests: input.context.verifiedManifests,
        });
        if (superseded) {
          throw new ProjectionDependencyUnavailableError(
            "Document purge cannot be ordered against a newer container checkpoint",
          );
        }
        if (documentPurgeCheckpoint) {
          await commitProjectionCheckpoints(
            { ...input.context, policies },
            {
              documentPurgeCheckpoint,
              execSql,
            },
          );
        }
      },
      { behavior: "immediate" },
    );
  });
}

export function validateDocumentPurgeCheckpoints(
  input: PurgeCheckpointInput,
): Promise<void> {
  return checkPurgeCheckpointCurrency(input);
}

export function commitDocumentPurgeCheckpoints(
  input: PurgeCheckpointInput & {
    readonly documentPurgeCheckpoint: DocumentPurgeCheckpoint;
  },
): Promise<void> {
  return checkPurgeCheckpointCurrency(input, input.documentPurgeCheckpoint);
}
