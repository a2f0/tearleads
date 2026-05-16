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
  const records = input.execSql
    ? await sqlContainerSyncWatermarkPersistence.loadWatermarkRecords(
        input.execSql,
        cursorDefinitions.map(({ lane }) => lane),
      )
    : [];

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
