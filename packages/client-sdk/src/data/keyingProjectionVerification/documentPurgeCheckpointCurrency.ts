import type {
  ReferencedPrincipalHead,
  VerifiedAccessManifestCheckpointEvidence,
  VerifiedPrincipalPolicySelection,
} from "@tearleads/crypto";
import type { DocumentPurgeCheckpoint } from "../persistence/documentPurgeCheckpointPersistence";
import { validateAccessManifestCheckpointEvidence } from "../persistence/keyingCheckpointEvidence";
import {
  accessManifestObjectKey,
  loadAccessManifestCheckpoint,
} from "../persistence/keyingCheckpointPersistence";
import { PrincipalAuthorizationCheckpointUnavailableError } from "../persistence/principalAuthorizationCheckpoints";
import { registerClientSQLiteCommitGuard } from "../sqlite/sqliteCommitGuards";
import { getClientSQLitePersistenceRuntime } from "../sqlite/sqlitePersistenceRuntime";
import { type ExecSql, runSerializedSqlMutation } from "../sqlite/sqlSchema";
import { validateAccessManifestCheckpoints } from "./accessManifestCheckpointEnforcement";
import {
  commitProjectionCheckpoints,
  type ProjectionCheckpointContext,
} from "./checkpointContext";
import { ProjectionDependencyUnavailableError } from "./dependencyUnavailable";
import { admitDocumentPurgePolicyCheckpoints } from "./documentPurgePolicyCheckpoints";
import { projectionLifetimeGuard } from "./projectionLifetimes";
import { assertProjectionVerificationCurrent } from "./types";

interface PurgeCheckpointInput {
  readonly context: ProjectionCheckpointContext;
  readonly execSql: ExecSql;
  readonly principalPolicies: readonly VerifiedPrincipalPolicySelection[];
  readonly observedPrincipalHeads: readonly ReferencedPrincipalHead[];
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
      async (transaction) => {
        const stillCurrent = projectionLifetimeGuard(input.context);
        registerClientSQLiteCommitGuard(execSql, () =>
          assertProjectionVerificationCurrent(stillCurrent),
        );
        const { current, superseded } = await currentContainerHeads({
          ...input,
          execSql,
        });
        // An older container must not conceal a document fork, a policy fork, or
        // conflicting current evidence for another container in the same proof.
        await validateAccessManifestCheckpoints({
          execSql,
          policies: [],
          authorizationPolicies: input.principalPolicies,
          verifiedHeads: current,
          verifiedManifests: input.context.verifiedManifests,
        });
        if (superseded) {
          throw new ProjectionDependencyUnavailableError(
            "Document purge cannot be ordered against a newer container checkpoint",
          );
        }
        if (documentPurgeCheckpoint) {
          // Only the complete authenticated terminal proof admits these public
          // observations. Page recovery and baseline verification never pin.
          await admitDocumentPurgePolicyCheckpoints({
            transaction,
            organizationId: input.context.organizationId,
            policies: input.principalPolicies,
            heads: input.observedPrincipalHeads,
          });
          assertProjectionVerificationCurrent(stillCurrent);
          await commitProjectionCheckpoints(
            {
              ...input.context,
              policies: [],
              authorizationPolicies: [...input.principalPolicies],
            },
            {
              documentPurgeCheckpoint,
              execSql,
            },
          );
        }
      },
      { behavior: "immediate" },
    );
  }).catch((error: unknown) => {
    if (error instanceof PrincipalAuthorizationCheckpointUnavailableError)
      throw new ProjectionDependencyUnavailableError(error.message);
    throw error;
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
