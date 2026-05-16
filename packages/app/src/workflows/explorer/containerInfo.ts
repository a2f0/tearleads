import type {
  ContainerAccessLevel,
  ContainerGrantSubjectType,
} from "@tearleads/crypto";
import type {
  ContainerWriterProjectionResponse,
  ListOrganizationGroupsResponse,
  OrganizationGroupSummaryResponse,
} from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import {
  getTargetContainerContext,
  readContainerState,
} from "../../data/containers/shared/projection";
import { ensureContainerTables } from "../../data/persistence/containers/containerPersistence";
import {
  type ContainerSyncWatermarkLane,
  containerDocumentsSyncLane,
  containerParentSyncLane,
  containerSyncWatermarkLaneKey,
  sqlContainerSyncWatermarkPersistence,
} from "../../data/persistence/containers/containerSyncWatermarkPersistence";
import { getAppDatabaseRuntime } from "../../data/sqlite/appDatabaseRuntime";
import { containers } from "../../data/sqlite/schema";
import type { ExecSql } from "../../data/sqlite/sqlSchema";

export type ExplorerContainerShareAccessLevel = ContainerAccessLevel;

export interface ExplorerContainerInfoGrant {
  accessLevel: ContainerAccessLevel;
  subjectId: string;
  subjectType: ContainerGrantSubjectType;
}

export interface ExplorerContainerInfoSyncCursor {
  label: string;
  laneId: string;
  laneKind: string;
  savedAt: string | null;
  watermarkId: string | null;
  watermarkUpdatedAt: string | null;
}

export interface ExplorerContainerInfoRemoteDetails {
  grants: ExplorerContainerInfoGrant[];
  groups: OrganizationGroupSummaryResponse[];
  syncCursors: ExplorerContainerInfoSyncCursor[];
}

export interface ExplorerContainerInfoLocalDetails {
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ExplorerContainerInfo {
  local: ExplorerContainerInfoLocalDetails;
  remoteInfo: ExplorerContainerInfoRemoteDetails | null;
}

interface ExplorerContainerInfoApi {
  getContainerWriterProjection: (
    containerId: string,
  ) => Promise<ContainerWriterProjectionResponse | null>;
  listOrganizationGroups: (
    organizationId: string,
  ) => Promise<ListOrganizationGroupsResponse | null>;
}

export type ExplorerContainerInfoRemoteMode = "always" | "if-synced" | "never";

interface LocalContainerInfoRecord {
  hasSyncedContainer: boolean;
  localCreatedAt: string | null;
  localUpdatedAt: string | null;
  parentId: string | null;
}

function sortContainerInfoGrants(
  grants: readonly ExplorerContainerInfoGrant[],
): ExplorerContainerInfoGrant[] {
  return [...grants].sort((left, right) =>
    `${left.subjectType}:${left.subjectId}`.localeCompare(
      `${right.subjectType}:${right.subjectId}`,
    ),
  );
}

interface ExplorerContainerInfoSyncCursorDefinition {
  label: string;
  lane: ContainerSyncWatermarkLane;
}

function getContainerSyncCursorDefinitions(input: {
  containerId: string;
  parentId: string | null;
}): ExplorerContainerInfoSyncCursorDefinition[] {
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
      lane: containerDocumentsSyncLane(input.containerId),
    },
  ];
}

async function loadContainerSyncCursors(input: {
  containerId: string;
  execSql: ExecSql | null;
  parentId: string | null;
}): Promise<ExplorerContainerInfoSyncCursor[]> {
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

  const { db } = getAppDatabaseRuntime(input.execSql);
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
  remoteInfoMode: ExplorerContainerInfoRemoteMode;
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

export async function loadExplorerContainerInfo(input: {
  apiClient: ExplorerContainerInfoApi;
  containerId: string;
  execSql?: ExecSql | null;
  organizationId: string | null;
  parentId?: string | null;
  remoteInfoMode?: ExplorerContainerInfoRemoteMode | undefined;
}): Promise<ExplorerContainerInfo> {
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

  const [projection, groupsResponse, syncCursors] = await Promise.all([
    input.apiClient.getContainerWriterProjection(input.containerId),
    input.organizationId
      ? input.apiClient.listOrganizationGroups(input.organizationId)
      : Promise.resolve(null),
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
      grants: sortContainerInfoGrants(
        state.directGrants.map((grant) => ({
          accessLevel: grant.accessLevel,
          subjectId: grant.subjectId,
          subjectType: grant.subjectType,
        })),
      ),
      groups: groupsResponse?.groups ?? [],
      syncCursors,
    },
  };
}
