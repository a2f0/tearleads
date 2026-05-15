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

export type ExplorerContainerShareAccessLevel = ContainerAccessLevel;

export interface ExplorerContainerInfoGrant {
  accessLevel: ContainerAccessLevel;
  subjectId: string;
  subjectType: ContainerGrantSubjectType;
}

export interface ExplorerContainerInfo {
  grants: ExplorerContainerInfoGrant[];
  groups: OrganizationGroupSummaryResponse[];
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

export async function loadExplorerContainerInfo(input: {
  apiClient: ExplorerContainerInfoApi;
  containerId: string;
  organizationId: string | null;
}): Promise<ExplorerContainerInfo> {
  const [projection, groupsResponse] = await Promise.all([
    input.apiClient.getContainerWriterProjection(input.containerId),
    input.organizationId
      ? input.apiClient.listOrganizationGroups(input.organizationId)
      : Promise.resolve(null),
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
  };
}
