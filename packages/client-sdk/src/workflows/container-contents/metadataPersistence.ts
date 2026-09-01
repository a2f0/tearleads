import { encodeVersionVector, exportUpdatesSince } from "@tearleads/loro";
import {
  getDefaultContainerName,
  readContainerMetadataValue,
  writeContainerMetadataValue,
} from "../../data/containers/containerMetadataDocument";
import { createPendingUpdateFields } from "../../data/documents/documentSync";
import type { ContainerContentsPersistence } from "../../data/persistence/container-contents/containerContentsPersistence";
import type { ContainerRecord } from "../../data/persistence/containers/containerPersistence";
import {
  type ExecSql,
  runSerializedSqlMutation,
} from "../../data/sqlite/sqlSchema";
import type { ContainerDocumentRecord as DocumentRecord } from "./containerPersistence";
import {
  currentMetadataPullContinuation,
  loadAuthoritativeContainerMetadataState,
  type PersistContainerMetadataStateInput,
  prepareContainerMetadataMutation,
} from "./metadataMutationPreparation";
import {
  buildContainerMetadataRecord,
  resolveContainerSystemSlot,
  resolveMetadataDocumentId,
} from "./metadataRecord";
import { installContainerMetadataRecord } from "./metadataStateInstallation";
import {
  type ExpectedContainerMetadataSyncState,
  metadataSyncSecurityContextMatches,
  replaceSupersededMetadataIdentity,
} from "./metadataSyncSettlement";
import type {
  ContainerMetadataPatch,
  ContainerMetadataState,
  PersistedContainerMetadataState,
} from "./metadataTypes";
import type { ContainerContentsWorkflowSqlRuntime } from "./runtime";

type ContainerMetadataPersistenceRuntime = ContainerContentsWorkflowSqlRuntime;
const MAX_METADATA_MUTATION_COMMIT_ATTEMPTS = 8;
type SaveContainerOptions = Parameters<
  ContainerContentsPersistence["saveContainer"]
>[3];

export {
  createReadOnlyMetadataSyncSaveOptions,
  hasCurrentContainerMetadataReadState,
} from "./metadataReadState";
export { installContainerMetadataRecord } from "./metadataStateInstallation";
export { currentMetadataPullContinuation };

function invalidateMetadataWriterProjection(
  metadataState: ContainerMetadataState,
  securityContextChanged: boolean,
): void {
  if (securityContextChanged) {
    metadataState.metadataWriterProjection = null;
  }
}
type PreparedContainerMetadataMutation = Awaited<
  ReturnType<typeof prepareContainerMetadataMutation>
>;
type ApplicableContainerMetadataMutation = Exclude<
  PreparedContainerMetadataMutation,
  { authoritativeState: unknown }
>;
async function settleSupersededMetadataMutation(input: {
  acceptedPendingUpdateIds?: readonly string[] | undefined;
  execSql: ExecSql;
  expectedRecord?: DocumentRecord | undefined;
  metadataState: ContainerMetadataState;
  persistence: ContainerContentsPersistence;
  prepared: PreparedContainerMetadataMutation;
  stillCurrent?: (() => boolean) | undefined;
}): Promise<PersistedContainerMetadataState | null> {
  const { metadataState, persistence, prepared } = input;
  const settledState = input.expectedRecord
    ? await persistence.settleAcceptedMetadataPendingUpdates(input.execSql, {
        containerId: metadataState.container.id,
        expectedRecord: input.expectedRecord,
        pendingUpdateIds: input.acceptedPendingUpdateIds ?? [],
        stillCurrent: input.stillCurrent,
      })
    : undefined;
  if ("authoritativeState" in prepared) {
    const authoritativeState = settledState ?? prepared.authoritativeState;
    if (!authoritativeState?.record) return null;
    metadataState.container = authoritativeState.container;
    installContainerMetadataRecord(metadataState, authoritativeState.record);
    return {
      container: authoritativeState.container,
      pullContinuationSuperseded: true,
      record: authoritativeState.record,
      syncIdentitySuperseded: true,
    };
  }
  const authoritativeState =
    settledState ??
    (await loadAuthoritativeContainerMetadataState({
      containerId: metadataState.container.id,
      execSql: input.execSql,
      persistence,
    }));
  if (!authoritativeState?.record) return null;
  // The rejected response may already have mutated the live Loro document.
  // Rebuild from the authoritative durable snapshot instead of merging into
  // that losing document, which would retain non-overlapping rejected fields.
  await replaceSupersededMetadataIdentity({
    durableRecord: authoritativeState.record,
    metadataState,
  });
  metadataState.container = authoritativeState.container;
  installContainerMetadataRecord(metadataState, authoritativeState.record);
  return {
    container: authoritativeState.container,
    pullContinuationSuperseded: true,
    record: authoritativeState.record,
    ...(!prepared.securityContextMatches
      ? { syncIdentitySuperseded: true as const }
      : {}),
  };
}
async function persistPreparedMetadataMutation(input: {
  clearSyncFailure?: boolean | undefined;
  createIntentSettlement?: Parameters<
    ContainerContentsPersistence["commitMetadataMutation"]
  >[1]["createIntentSettlement"];
  execSql: ExecSql;
  metadataState: ContainerMetadataState;
  moveIntentSettlement?: Parameters<
    ContainerContentsPersistence["commitMetadataMutation"]
  >[1]["moveIntentSettlement"];
  persistence: ContainerContentsPersistence;
  prepared: ApplicableContainerMetadataMutation;
  acceptedPendingUpdateIds?: readonly string[] | undefined;
  preserveDurableStructureWhenPending?: boolean | undefined;
  saveOptions?: SaveContainerOptions;
  stillCurrent?: (() => boolean) | undefined;
}): Promise<
  | PersistedContainerMetadataState
  | {
      conflict: true;
      currentState: Awaited<
        ReturnType<ContainerContentsPersistence["loadContainerMetadataState"]>
      >;
      staleServerState?: true;
    }
> {
  const { metadataState, persistence, prepared } = input;
  const metadata = readContainerMetadataValue(
    metadataState.doc,
    getDefaultContainerName(prepared.mutationContainer.parentId),
  );
  const nextContainer: ContainerRecord = {
    ...prepared.mutationContainer,
    ...(prepared.mutationPatch.effectiveAccessLevel !== undefined
      ? {
          effectiveAccessLevel: prepared.mutationPatch.effectiveAccessLevel,
        }
      : {}),
    organizationId:
      prepared.mutationPatch.organizationId ??
      prepared.mutationContainer.organizationId,
    parentId:
      prepared.mutationPatch.parentId ?? prepared.mutationContainer.parentId,
    metadataDocumentId: resolveMetadataDocumentId(
      prepared.mutationPatch,
      prepared.mutationContainer,
    ),
    systemSlot: resolveContainerSystemSlot(
      prepared.mutationPatch,
      prepared.mutationContainer,
    ),
    name: prepared.mutationPatch.name ?? metadata.name,
    icon:
      prepared.mutationPatch.icon !== undefined
        ? prepared.mutationPatch.icon
        : metadata.icon,
  };
  const nextRecord = buildContainerMetadataRecord({
    metadataState: prepared.mutationMetadataState,
    patch: prepared.mutationPatch,
    securityContext: prepared.securityContext,
  });
  const pendingUpdate = prepared.pendingLocalUpdate
    ? (createPendingUpdateFields(prepared.pendingLocalUpdate) ?? undefined)
    : undefined;
  const committed = await persistence.commitMetadataMutation(input.execSql, {
    acceptedPendingUpdateIds: input.acceptedPendingUpdateIds ?? [],
    clearSyncFailure: input.clearSyncFailure,
    container: nextContainer,
    createIntentSettlement: input.createIntentSettlement,
    expectedContainer: prepared.mutationContainer,
    expectedRecord: prepared.durableRecord,
    moveIntentSettlement: input.moveIntentSettlement,
    pendingUpdate,
    preserveDurableStructureWhenPending:
      input.preserveDurableStructureWhenPending,
    record: nextRecord,
    saveOptions: input.saveOptions,
    settleAcceptedPendingOnConflict:
      input.acceptedPendingUpdateIds !== undefined,
    stillCurrent: input.stillCurrent,
  });
  if (!committed.committed) {
    return {
      conflict: true,
      currentState: committed.currentState,
      ...(committed.staleServerState
        ? { staleServerState: true as const }
        : {}),
    };
  }
  invalidateMetadataWriterProjection(
    metadataState,
    prepared.securityContext.changed,
  );
  return {
    container: committed.container,
    record: nextRecord,
    ...(committed.moveIntentSettled
      ? { moveIntentSettled: true as const }
      : {}),
  };
}
async function adoptMetadataCommitConflict(input: {
  currentState: Awaited<
    ReturnType<ContainerContentsPersistence["loadContainerMetadataState"]>
  >;
  expectedRecord: DocumentRecord;
  expectedSyncState?: ExpectedContainerMetadataSyncState | undefined;
  metadataState: ContainerMetadataState;
  staleServerState?: true | undefined;
}): Promise<PersistedContainerMetadataState | null | "retry"> {
  if (!input.staleServerState && input.expectedSyncState === undefined) {
    return "retry";
  }
  if (!input.currentState?.record) return null;
  await replaceSupersededMetadataIdentity({
    durableRecord: input.currentState.record,
    metadataState: input.metadataState,
  });
  input.metadataState.container = input.currentState.container;
  installContainerMetadataRecord(
    input.metadataState,
    input.currentState.record,
  );
  return {
    container: input.currentState.container,
    pullContinuationSuperseded: true,
    record: input.currentState.record,
    ...(input.staleServerState ? { mutationSuperseded: true as const } : {}),
    ...(!metadataSyncSecurityContextMatches(
      input.currentState.record,
      input.expectedSyncState?.record ?? input.expectedRecord,
    )
      ? { syncIdentitySuperseded: true as const }
      : {}),
  };
}
async function persistContainerMetadataState(
  input: PersistContainerMetadataStateInput,
): Promise<PersistedContainerMetadataState | null> {
  const patch = input.patch ?? {};
  const prepareMutation = prepareContainerMetadataMutation;
  return runSerializedSqlMutation(input.execSql, async (lockedExecSql) => {
    for (
      let attempt = 0;
      attempt < MAX_METADATA_MUTATION_COMMIT_ATTEMPTS;
      attempt += 1
    ) {
      const prepared = await prepareMutation(input, lockedExecSql, patch);
      if (input.stillCurrent?.() === false) return null;
      if (
        "authoritativeState" in prepared ||
        prepared.pullContinuationSuperseded
      ) {
        return settleSupersededMetadataMutation({
          acceptedPendingUpdateIds: input.acceptedPendingUpdateIds,
          execSql: lockedExecSql,
          expectedRecord: input.expectedSyncState?.record,
          metadataState: input.metadataState,
          persistence: input.persistence,
          prepared,
          stillCurrent: input.stillCurrent,
        });
      }
      const persisted = await persistPreparedMetadataMutation({
        acceptedPendingUpdateIds: input.acceptedPendingUpdateIds,
        clearSyncFailure: input.clearSyncFailure,
        createIntentSettlement: input.createIntentSettlement,
        execSql: lockedExecSql,
        metadataState: input.metadataState,
        moveIntentSettlement: input.moveIntentSettlement,
        persistence: input.persistence,
        prepared,
        preserveDurableStructureWhenPending:
          input.preserveDurableStructureWhenPending,
        saveOptions: input.saveOptions,
        stillCurrent: input.stillCurrent,
      });
      if (input.stillCurrent?.() === false) return null;
      if (!("conflict" in persisted)) return persisted;
      const conflict = await adoptMetadataCommitConflict({
        currentState: persisted.currentState,
        expectedRecord: prepared.durableRecord,
        expectedSyncState: input.expectedSyncState,
        metadataState: input.metadataState,
        staleServerState: persisted.staleServerState,
      });
      if (conflict !== "retry") return conflict;
    }
    throw new Error(
      `Container metadata mutation commit gave up after ${MAX_METADATA_MUTATION_COMMIT_ATTEMPTS} concurrent conflicts`,
    );
  });
}
type PersistContainerMetadataStateRuntimeInput = Omit<
  PersistContainerMetadataStateInput,
  "execSql"
> & {
  onDurableStateNeedsReload?: (() => void) | undefined;
  persistence: ContainerContentsPersistence;
  runtime: ContainerMetadataPersistenceRuntime;
};

export function persistContainerMetadataStateFromRuntime(
  input: PersistContainerMetadataStateRuntimeInput & {
    expectedSyncState: ExpectedContainerMetadataSyncState;
  },
): Promise<PersistedContainerMetadataState | null>;
export function persistContainerMetadataStateFromRuntime(
  input: PersistContainerMetadataStateRuntimeInput & {
    expectedSyncState?: undefined;
  },
): Promise<PersistedContainerMetadataState | null>;
export async function persistContainerMetadataStateFromRuntime(
  input: PersistContainerMetadataStateRuntimeInput,
): Promise<PersistedContainerMetadataState | null> {
  const { onDurableStateNeedsReload, runtime, ...persistenceInput } = input;
  const execSql = runtime.infra.execSql;
  const persisted = await persistContainerMetadataState({
    ...persistenceInput,
    execSql,
  });
  if (input.stillCurrent?.() === false) {
    onDurableStateNeedsReload?.();
    return null;
  }
  return persisted;
}

async function writeContainerMetadataPatch(input: {
  execSql: ExecSql;
  metadataState: ContainerMetadataState;
  patch: Partial<Pick<ContainerMetadataPatch, "icon" | "name">>;
  persistence: ContainerContentsPersistence;
  stillCurrent?: (() => boolean) | undefined;
}): Promise<PersistedContainerMetadataState | null> {
  const { execSql, metadataState, patch, persistence } = input;
  const metadata = readContainerMetadataValue(
    metadataState.doc,
    getDefaultContainerName(metadataState.container.parentId),
  );
  const previousVersion = encodeVersionVector(metadataState.doc);
  writeContainerMetadataValue(metadataState.doc, { ...metadata, ...patch });
  const update = exportUpdatesSince(metadataState.doc, previousVersion);

  return persistContainerMetadataState({
    execSql,
    localMetadataPatch: patch,
    localUpdate: update,
    metadataState,
    patch,
    persistence,
    stillCurrent: input.stillCurrent,
  });
}

export async function renameContainerMetadataStateFromRuntime(input: {
  metadataState: ContainerMetadataState;
  name: string;
  persistence: ContainerContentsPersistence;
  runtime: ContainerMetadataPersistenceRuntime;
  stillCurrent?: (() => boolean) | undefined;
}): Promise<PersistedContainerMetadataState | null> {
  const trimmedName = input.name.trim();
  if (!trimmedName) {
    return null;
  }

  return writeContainerMetadataPatch({
    execSql: input.runtime.infra.execSql,
    metadataState: input.metadataState,
    patch: { name: trimmedName },
    persistence: input.persistence,
    stillCurrent: input.stillCurrent,
  });
}

export async function setContainerIconMetadataStateFromRuntime(input: {
  icon: string | null;
  metadataState: ContainerMetadataState;
  persistence: ContainerContentsPersistence;
  runtime: ContainerMetadataPersistenceRuntime;
  stillCurrent?: (() => boolean) | undefined;
}): Promise<PersistedContainerMetadataState | null> {
  return writeContainerMetadataPatch({
    execSql: input.runtime.infra.execSql,
    metadataState: input.metadataState,
    patch: { icon: input.icon?.trim() || null },
    persistence: input.persistence,
    stillCurrent: input.stillCurrent,
  });
}
