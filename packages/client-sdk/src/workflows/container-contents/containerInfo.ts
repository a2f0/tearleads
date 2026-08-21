import type {
  ContainerAccessLevel,
  ContainerGrantSubjectType,
} from "@symcrypt/crypto";
import type {
  ContainerWriterProjectionResponse,
  OrganizationGroupSummaryResponse,
} from "@symcrypt/validators/response";
import { eq } from "drizzle-orm";
import {
  getTargetContainerContext,
  readContainerState,
} from "../../data/containers/shared/projection";
import { ensureContainerTables } from "../../data/persistence/containers/containerPersistence";
import {
  type ContainerSyncWatermarkLane,
  containerContentsSyncLane,
  containerParentSyncLane,
  containerSyncWatermarkLaneKey,
  sqlContainerSyncWatermarkPersistence,
} from "../../data/persistence/containers/containerSyncWatermarkPersistence";
import { containers } from "../../data/sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../data/sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../data/sqlite/sqlSchema";

export type ContainerShareAccessLevel = ContainerAccessLevel;

export interface ContainerInfoGrant {
  accessLevel: ContainerAccessLevel;
  subjectId: string;
  subjectType: ContainerGrantSubjectType;
}

export interface ContainerInfoGrantRow extends ContainerInfoGrant {
  inherited: boolean;
  sourceContainerId: string;
}

export interface ContainerInfoSyncCursor {
  label: string;
  laneId: string;
  laneKind: string;
  savedAt: string | null;
  watermarkId: string | null;
  watermarkUpdatedAt: string | null;
}

export interface ContainerInfoPathEntry {
  containerId: string;
  containerKeyEpoch: number;
  containerKeyEpochId: string;
  directGrantCount: number;
  eventHash: string;
  keyEpochHash: string;
  keyTargetHash: string;
  manifestHash: string;
  manifestHistoryCount: number;
  parentContainerId: string | null;
  parentManifestHash: string | null;
  recipientTargetCount: number;
  referencedPrincipalCount: number;
  wrapCount: number;
}

export interface ContainerInfoSecurityDetails {
  currentContainerKeyEpoch: number;
  currentContainerKeyEpochId: string;
  currentManifestHash: string;
  currentManifestHistoryCount: number;
  currentParentContainerKeyEpochId: string | null;
  currentReferencedPrincipalCount: number;
  path: ContainerInfoPathEntry[];
  pathLength: number;
}

export interface ContainerInfoRemoteDetails {
  grantRows: ContainerInfoGrantRow[];
  grants: ContainerInfoGrant[];
  groups: OrganizationGroupSummaryResponse[];
  security?: ContainerInfoSecurityDetails;
  syncCursors: ContainerInfoSyncCursor[];
}

export interface ContainerInfoLocalDetails {
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ContainerInfo {
  local: ContainerInfoLocalDetails;
  remoteInfo: ContainerInfoRemoteDetails | null;
}

interface ContainerInfoApi {
  getContainerWriterProjection: (
    containerId: string,
  ) => Promise<ContainerWriterProjectionResponse | null>;
}

export type ContainerInfoRemoteMode = "always" | "if-synced" | "never";

interface LocalContainerInfoRecord {
  hasSyncedContainer: boolean;
  localCreatedAt: string | null;
  localUpdatedAt: string | null;
  parentId: string | null;
}

function sortContainerInfoGrants<T extends ContainerInfoGrant>(
  grants: readonly T[],
): T[] {
  return [...grants].sort((left, right) =>
    `${left.subjectType}:${left.subjectId}`.localeCompare(
      `${right.subjectType}:${right.subjectId}`,
    ),
  );
}

function toContainerInfoGrant(grant: ContainerInfoGrant): ContainerInfoGrant {
  return {
    accessLevel: grant.accessLevel,
    subjectId: grant.subjectId,
    subjectType: grant.subjectType,
  };
}

function getContainerInfoGrantRows(
  projection: ContainerWriterProjectionResponse,
): ContainerInfoGrantRow[] {
  const rows = projection.path.flatMap((bundle) => {
    const state = readContainerState(bundle);

    return state.directGrants.map((grant) => ({
      ...toContainerInfoGrant(grant),
      inherited: state.containerId !== projection.containerId,
      sourceContainerId: state.containerId,
    }));
  });

  return sortContainerInfoGrants(rows);
}

function getContainerInfoPathEntries(
  projection: ContainerWriterProjectionResponse,
): ContainerInfoPathEntry[] {
  return projection.path.map((bundle, index) => {
    const state = readContainerState(bundle);
    const kek = projection.containerKeks[index];
    if (!kek) {
      throw new Error("Container projection path and KEKs are inconsistent");
    }

    return {
      containerId: state.containerId,
      containerKeyEpoch: kek.containerKeyEpoch,
      containerKeyEpochId: kek.containerKeyEpochId,
      directGrantCount: state.directGrants.length,
      eventHash: state.eventHash,
      keyEpochHash: kek.keyEpochHash,
      keyTargetHash: kek.keyTargetHash,
      manifestHash: bundle.manifestHash,
      manifestHistoryCount: kek.containerManifestHistory.length,
      parentContainerId: state.parentContainerId,
      parentManifestHash: state.parentManifestHash,
      recipientTargetCount: kek.recipientTargets.length,
      referencedPrincipalCount: state.referencedPrincipalHeads.length,
      wrapCount: kek.wraps.length,
    };
  });
}

function getContainerInfoSecurityDetails(
  projection: ContainerWriterProjectionResponse,
): ContainerInfoSecurityDetails {
  const path = getContainerInfoPathEntries(projection);
  const targetPathEntry = path.at(-1);
  const targetKek = projection.containerKeks.at(-1);
  if (!targetPathEntry || !targetKek) {
    throw new Error("Container projection is empty");
  }

  return {
    currentContainerKeyEpoch: targetPathEntry.containerKeyEpoch,
    currentContainerKeyEpochId: targetPathEntry.containerKeyEpochId,
    currentManifestHash: targetPathEntry.manifestHash,
    currentManifestHistoryCount: targetPathEntry.manifestHistoryCount,
    currentParentContainerKeyEpochId: targetKek.parentContainerKeyEpochId,
    currentReferencedPrincipalCount: targetPathEntry.referencedPrincipalCount,
    path,
    pathLength: path.length,
  };
}

interface ContainerInfoSyncCursorDefinition {
  label: string;
  lane: ContainerSyncWatermarkLane;
}

function getContainerSyncCursorDefinitions(input: {
  containerId: string;
  parentId: string | null;
}): ContainerInfoSyncCursorDefinition[] {
  return [
    {
      label: "Parent Listing",
      lane: containerParentSyncLane(input.parentId),
    },
    {
      label: "Child Containers",
      lane: containerParentSyncLane(input.containerId),
    },
    {
      label: "Documents",
      lane: containerContentsSyncLane(input.containerId),
    },
  ];
}

async function loadContainerSyncCursors(input: {
  containerId: string;
  execSql: ExecSql | null;
  parentId: string | null;
}): Promise<ContainerInfoSyncCursor[]> {
  const cursorDefinitions = getContainerSyncCursorDefinitions(input);
  let records: Awaited<
    ReturnType<typeof sqlContainerSyncWatermarkPersistence.loadWatermarkRecords>
  > = [];
  if (input.execSql) {
    await sqlContainerSyncWatermarkPersistence.ensureSchema(input.execSql);
    records = await sqlContainerSyncWatermarkPersistence.loadWatermarkRecords(
      input.execSql,
      cursorDefinitions.map(({ lane }) => lane),
    );
  }

  return cursorDefinitions.map((definition, index) => {
    const { laneId, laneKind } = containerSyncWatermarkLaneKey(definition.lane);
    const record = records[index] ?? null;

    return {
      label: definition.label,
      laneId,
      laneKind,
      savedAt: record?.updatedAt ?? null,
      watermarkId: record?.watermark.id ?? null,
      watermarkUpdatedAt: record?.watermark.updatedAt ?? null,
    };
  });
}

async function loadLocalContainerInfoRecord(input: {
  containerId: string;
  execSql: ExecSql | null;
  parentId: string | null;
}): Promise<LocalContainerInfoRecord> {
  const fallback: LocalContainerInfoRecord = {
    hasSyncedContainer: false,
    localCreatedAt: null,
    localUpdatedAt: null,
    parentId: input.parentId,
  };

  if (!input.execSql) {
    return fallback;
  }

  await ensureContainerTables(input.execSql);

  const { db } = getClientSQLitePersistenceRuntime(input.execSql);
  const rows = await db
    .select({
      localCreatedAt: containers.localCreatedAt,
      localUpdatedAt: containers.localUpdatedAt,
      metadataDocumentId: containers.metadataDocumentId,
      parentId: containers.parentId,
    })
    .from(containers)
    .where(eq(containers.id, input.containerId))
    .limit(1);
  const row = rows[0];

  if (!row) {
    return fallback;
  }

  return {
    hasSyncedContainer:
      typeof row.metadataDocumentId === "string" &&
      row.metadataDocumentId.length > 0,
    localCreatedAt: row.localCreatedAt,
    localUpdatedAt: row.localUpdatedAt,
    parentId: row.parentId,
  };
}

function shouldLoadRemoteContainerInfo(input: {
  localContainerInfo: LocalContainerInfoRecord;
  remoteInfoMode: ContainerInfoRemoteMode;
}): boolean {
  switch (input.remoteInfoMode) {
    case "always":
      return true;
    case "if-synced":
      return input.localContainerInfo.hasSyncedContainer;
    case "never":
      return false;
  }
}

export async function loadContainerInfo(input: {
  apiClient: ContainerInfoApi;
  containerId: string;
  containerProjection?: ContainerWriterProjectionResponse | null | undefined;
  execSql?: ExecSql | null;
  loadOrganizationGroups: () => Promise<
    ReadonlyArray<OrganizationGroupSummaryResponse>
  >;
  parentId?: string | null;
  remoteInfoMode?: ContainerInfoRemoteMode | undefined;
}): Promise<ContainerInfo> {
  const localContainerInfo = await loadLocalContainerInfoRecord({
    containerId: input.containerId,
    execSql: input.execSql ?? null,
    parentId: input.parentId ?? null,
  });
  const local = {
    createdAt: localContainerInfo.localCreatedAt,
    updatedAt: localContainerInfo.localUpdatedAt,
  };

  if (
    !shouldLoadRemoteContainerInfo({
      localContainerInfo,
      remoteInfoMode: input.remoteInfoMode ?? "always",
    })
  ) {
    return {
      local,
      remoteInfo: null,
    };
  }

  const [projection, groups, syncCursors] = await Promise.all([
    input.containerProjection
      ? Promise.resolve(input.containerProjection)
      : input.apiClient.getContainerWriterProjection(input.containerId),
    input.loadOrganizationGroups(),
    loadContainerSyncCursors({
      containerId: input.containerId,
      execSql: input.execSql ?? null,
      parentId: localContainerInfo.parentId,
    }),
  ]);

  if (!projection) {
    throw new Error("Container info could not be loaded.");
  }

  const target = getTargetContainerContext(projection);
  const state = readContainerState(target.manifest);

  return {
    local,
    remoteInfo: {
      grantRows: getContainerInfoGrantRows(projection),
      grants: sortContainerInfoGrants(
        state.directGrants.map(toContainerInfoGrant),
      ),
      groups: [...groups],
      security: getContainerInfoSecurityDetails(projection),
      syncCursors,
    },
  };
}
