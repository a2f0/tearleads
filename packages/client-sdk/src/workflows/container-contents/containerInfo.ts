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

export interface ContainerInfoSyncCursor {
  label: string;
  laneId: string;
  laneKind: string;
  savedAt: string | null;
  watermarkId: string | null;
  watermarkUpdatedAt: string | null;
}

export interface ContainerInfoRemoteDetails {
  grants: ContainerInfoGrant[];
  groups: OrganizationGroupSummaryResponse[];
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
  listOrganizationGroups: (
    organizationId: string,
  ) => Promise<ListOrganizationGroupsResponse | null>;
}

export type ContainerInfoRemoteMode = "always" | "if-synced" | "never";

interface LocalContainerInfoRecord {
  hasSyncedContainer: boolean;
  localCreatedAt: string | null;
  localUpdatedAt: string | null;
  parentId: string | null;
}

function sortContainerInfoGrants(
  grants: readonly ContainerInfoGrant[],
): ContainerInfoGrant[] {
  return [...grants].sort((left, right) =>
    `${left.subjectType}:${left.subjectId}`.localeCompare(
      `${right.subjectType}:${right.subjectId}`,
    ),
  );
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
  execSql?: ExecSql | null;
  organizationId: string | null;
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
