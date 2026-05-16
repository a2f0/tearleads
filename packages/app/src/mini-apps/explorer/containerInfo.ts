import type {
  ContainerAccessLevel,
  ContainerGrantSubjectType,
} from "@tearleads/crypto";
import type {
  ContainerWriterProjectionResponse,
  ListOrganizationGroupsResponse,
  OrganizationGroupSummaryResponse,
} from "@tearleads/validators/response";
import {
  getTargetContainerContext,
  readContainerState,
} from "../../data/containers/shared/projection";
import {
  type ContainerSyncWatermarkLane,
  containerDocumentsSyncLane,
  containerParentSyncLane,
  containerSyncWatermarkLaneKey,
  sqlContainerSyncWatermarkPersistence,
} from "../../data/persistence/containers/containerSyncWatermarkPersistence";
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

export interface ExplorerContainerInfo {
  grants: ExplorerContainerInfoGrant[];
  groups: OrganizationGroupSummaryResponse[];
  syncCursors: ExplorerContainerInfoSyncCursor[];
}

interface ExplorerContainerInfoApi {
  getContainerWriterProjection: (
    containerId: string,
  ) => Promise<ContainerWriterProjectionResponse | null>;
  listOrganizationGroups: (
    organizationId: string,
  ) => Promise<ListOrganizationGroupsResponse | null>;
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

async function loadSyncCursor(input: {
  execSql: ExecSql | null;
  label: string;
  lane: ContainerSyncWatermarkLane;
}): Promise<ExplorerContainerInfoSyncCursor> {
  const { laneId, laneKind } = containerSyncWatermarkLaneKey(input.lane);
  const record = input.execSql
    ? await sqlContainerSyncWatermarkPersistence.loadWatermarkRecord(
        input.execSql,
        input.lane,
      )
    : null;

  return {
    label: input.label,
    laneId,
    laneKind,
    savedAt: record?.updatedAt ?? null,
    watermarkId: record?.watermark.id ?? null,
    watermarkUpdatedAt: record?.watermark.updatedAt ?? null,
  };
}

function loadContainerSyncCursors(input: {
  containerId: string;
  execSql: ExecSql | null;
  parentId: string | null;
}): Promise<ExplorerContainerInfoSyncCursor[]> {
  return Promise.all([
    loadSyncCursor({
      execSql: input.execSql,
      label: "Parent Listing",
      lane: containerParentSyncLane(input.parentId),
    }),
    loadSyncCursor({
      execSql: input.execSql,
      label: "Child Containers",
      lane: containerParentSyncLane(input.containerId),
    }),
    loadSyncCursor({
      execSql: input.execSql,
      label: "Documents",
      lane: containerDocumentsSyncLane(input.containerId),
    }),
  ]);
}

export async function loadExplorerContainerInfo(input: {
  apiClient: ExplorerContainerInfoApi;
  containerId: string;
  execSql?: ExecSql | null;
  organizationId: string | null;
  parentId?: string | null;
}): Promise<ExplorerContainerInfo> {
  const [projection, groupsResponse, syncCursors] = await Promise.all([
    input.apiClient.getContainerWriterProjection(input.containerId),
    input.organizationId
      ? input.apiClient.listOrganizationGroups(input.organizationId)
      : Promise.resolve(null),
    loadContainerSyncCursors({
      containerId: input.containerId,
      execSql: input.execSql ?? null,
      parentId: input.parentId ?? null,
    }),
  ]);

  if (!projection) {
    throw new Error("Container info could not be loaded.");
  }

  const target = getTargetContainerContext(projection);
  const state = readContainerState(target.manifest);

  return {
    grants: sortContainerInfoGrants(
      state.directGrants.map((grant) => ({
        accessLevel: grant.accessLevel,
        subjectId: grant.subjectId,
        subjectType: grant.subjectType,
      })),
    ),
    groups: groupsResponse?.groups ?? [],
    syncCursors,
  };
}
