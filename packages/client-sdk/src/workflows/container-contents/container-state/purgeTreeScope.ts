import { KeyingVerificationError } from "@tearleads/crypto";
import type { DocumentSummary } from "../../../data/documents/documentSummary";
import { errorMessage } from "../../../data/errorMessage";
import type { ProjectionUserKeyResolver } from "../../../data/keyingProjectionVerification";
import { verifyContainerWriterProjection } from "../../../data/keyingProjectionVerification/containerProjectionVerification";
import { runWithSecurityIncidentReporting } from "../../../data/keyingProjectionVerification/error";
import { rethrowProjectionVerificationCancelled } from "../../../data/keyingProjectionVerification/types";
import { hasUnsettledDocumentPlacement } from "../../../data/persistence/container-contents/documentPurgePlacement";
import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
import { createRuntimePrincipalPolicyWarmer } from "../../principals/runtimePolicyWarmer";
import type { ContainerContentsPersistence } from "../containerPersistence";
import type { ContainerState } from "../remoteHydration";
import type { ContainerContentsWorkflowRuntime } from "../runtime";

interface SubtreePurgeScopeInput {
  containersById: ReadonlyMap<string, ContainerState>;
  persistence: ContainerContentsPersistence;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  rootContainerId: string;
  runtime: ContainerContentsWorkflowRuntime;
  stillCurrent?: (() => boolean) | undefined;
}

async function verifiedRemoteScope(
  input: SubtreePurgeScopeInput,
  current: Pick<ContainerState, "container" | "record">,
): Promise<boolean> {
  const { runtime, rootContainerId } = input;
  const targetId = current.container.id;
  return runWithSecurityIncidentReporting(
    runtime.util.reportSecurityIncident,
    {
      objectId: targetId,
      objectKind: "container",
      operation: "container.purge.scope",
    },
    async () => {
      runtime.apiClient.evictContainerWriterProjection(targetId);
      const projection =
        await runtime.apiClient.getContainerWriterProjection(targetId);
      if (!projection || input.stillCurrent?.() === false) return false;
      if (
        projection.containerId !== targetId ||
        projection.organizationId !== current.container.organizationId
      ) {
        throw new KeyingVerificationError(
          "object_mismatch",
          "Subtree purge container identity mismatch",
        );
      }
      const path = await verifyContainerWriterProjection({
        execSql: runtime.infra.execSql,
        projection,
        resolveUserKey: input.resolveProjectionUserKey,
        stillCurrent: input.stillCurrent,
        warmReferencedPrincipalPolicies:
          createRuntimePrincipalPolicyWarmer(runtime),
      });
      const rootIndex = path.findIndex(
        (head) => head.state.containerId === rootContainerId,
      );
      const pendingMoves = new Set(
        (
          await input.persistence.listUnsyncedMoveIntents(runtime.infra.execSql)
        ).map((intent) => intent.containerId),
      );
      const latest = await input.persistence.loadContainerMetadataState(
        runtime.infra.execSql,
        targetId,
      );
      return (
        rootIndex >= 0 &&
        latest?.container.parentId === current.container.parentId &&
        latest.record?.documentId === current.record.documentId &&
        !path
          .slice(rootIndex + 1)
          .some((head) => pendingMoves.has(head.state.containerId)) &&
        input.stillCurrent?.() !== false
      );
    },
  );
}

async function allowsContainer(
  input: SubtreePurgeScopeInput,
  containerId: string,
): Promise<boolean> {
  const { runtime, persistence, rootContainerId } = input;
  if (input.stillCurrent?.() === false) return false;
  if (containerId === rootContainerId) return true;
  const execSql = runtime.infra.execSql;
  const pendingMoves = new Set(
    (await persistence.listUnsyncedMoveIntents(execSql)).map(
      (intent) => intent.containerId,
    ),
  );
  const seen = new Set<string>();
  let currentId: string | null = containerId;
  while (currentId !== rootContainerId) {
    if (!currentId || seen.has(currentId) || pendingMoves.has(currentId))
      return false;
    seen.add(currentId);
    const expected = input.containersById.get(currentId);
    const current = await persistence.loadContainerMetadataState(
      execSql,
      currentId,
    );
    if (
      !expected ||
      !current?.record ||
      current.container.parentId !== expected.container.parentId ||
      current.container.organizationId !== expected.container.organizationId ||
      current.record.documentId !== expected.record.documentId
    )
      return false;
    if (current.record.documentId)
      return verifiedRemoteScope(input, {
        container: current.container,
        record: current.record,
      });
    currentId = current.container.parentId;
  }
  return input.stillCurrent?.() !== false;
}

async function documentPlacementIsCurrent(
  input: SubtreePurgeScopeInput,
  document: DocumentSummary,
): Promise<boolean> {
  const execSql = input.runtime.infra.execSql;
  if (await hasUnsettledDocumentPlacement(execSql, document.id)) return false;
  const current = await sqlDocumentsPersistence.loadDocument(
    execSql,
    document.id,
  );
  return (
    current !== null &&
    current.documentId === document.documentId &&
    current.containerId === document.containerId &&
    input.stillCurrent?.() !== false
  );
}

/** Listing edges only select candidates; each destructive unit proves its scope. */
export function createSubtreePurgeScope(input: SubtreePurgeScopeInput) {
  return {
    allowsContainer: (containerId: string) =>
      checkAvailableScope(input, () => allowsContainer(input, containerId)),
    allowsDocument: (document: DocumentSummary) =>
      checkAvailableScope(input, async () => {
        if (
          !document.containerId ||
          !(await documentPlacementIsCurrent(input, document))
        )
          return false;
        if (!(await allowsContainer(input, document.containerId))) return false;
        // A restore can be queued while signature and ancestry verification await.
        return documentPlacementIsCurrent(input, document);
      }),
  };
}

async function checkAvailableScope(
  input: SubtreePurgeScopeInput,
  check: () => Promise<boolean>,
): Promise<boolean> {
  try {
    return await check();
  } catch (error) {
    rethrowProjectionVerificationCancelled(error);
    if (error instanceof KeyingVerificationError) throw error;
    input.runtime.util.log(
      `Container contents: purge scope unavailable: ${errorMessage(error)}`,
    );
    return false;
  }
}
