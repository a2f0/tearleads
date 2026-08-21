import type { OrganizationReadModelResponse } from "@symcrypt/validators/response";
import { ORGANIZATION_READ_MODEL_PROTOCOL_VERSION } from "./organizationReadModelProtocol";

function assertUniqueIds(values: ReadonlyArray<string>, label: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`Organization read-model ${label} contains duplicate IDs`);
  }
}

export function assertOrganizationReadModelResponse(input: {
  readonly currentUserId: string;
  readonly response: OrganizationReadModelResponse;
}): void {
  const { response } = input;
  if (response.version !== ORGANIZATION_READ_MODEL_PROTOCOL_VERSION) {
    throw new Error("Organization read-model protocol version is unsupported");
  }
  if (
    response.lanes.directory?.organizationId !== undefined &&
    response.lanes.directory.organizationId !== response.organizationId
  ) {
    throw new Error("Organization directory response scope does not match");
  }
  if (
    response.lanes.groups?.organizationId !== undefined &&
    response.lanes.groups.organizationId !== response.organizationId
  ) {
    throw new Error("Organization groups response scope does not match");
  }
  if (
    response.lanes.groupMemberships?.organizationId !== undefined &&
    response.lanes.groupMemberships.organizationId !== response.organizationId
  ) {
    throw new Error("Organization group memberships scope does not match");
  }
  if (
    response.lanes.grants?.organizationId !== undefined &&
    response.lanes.grants.organizationId !== response.organizationId
  ) {
    throw new Error("Organization grants response scope does not match");
  }
  if (
    response.lanes.organizationPolicy?.organizationId !== undefined &&
    response.lanes.organizationPolicy.organizationId !== response.organizationId
  ) {
    throw new Error("Organization policy response scope does not match");
  }
  if (
    response.lanes.groups?.groups.some(
      (group) => group.organizationId !== response.organizationId,
    )
  ) {
    throw new Error("Organization group row scope does not match");
  }

  const directoryUsers = response.lanes.directory?.users ?? [];
  assertUniqueIds(
    directoryUsers.map((user) => user.userId),
    "directory",
  );
  if (
    directoryUsers.some(
      (user) => user.isSelf !== (user.userId === input.currentUserId),
    )
  ) {
    throw new Error("Organization directory requester flags do not match");
  }
  assertUniqueIds(
    response.lanes.groups?.groups.map((group) => group.groupId) ?? [],
    "groups",
  );
}
