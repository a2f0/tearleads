import type {
  OrganizationContainerGrant,
  OrganizationContainerGrants,
  OrganizationGroupContainers,
  OrganizationUserDetail,
} from "@tearleads/client-sdk";

function isSameGrantSubject(
  left: OrganizationContainerGrant,
  right: OrganizationContainerGrant,
): boolean {
  return (
    left.subjectType === right.subjectType && left.subjectId === right.subjectId
  );
}

function isSameContainerGrant(
  left: OrganizationContainerGrant,
  right: OrganizationContainerGrant,
): boolean {
  return (
    left.containerId === right.containerId && isSameGrantSubject(left, right)
  );
}

function removeRevokedGrantRows(
  grants: ReadonlyArray<OrganizationContainerGrant>,
  revokedGrant: OrganizationContainerGrant,
): OrganizationContainerGrant[] {
  return grants.filter((grant) => !isSameContainerGrant(grant, revokedGrant));
}

export function removeRevokedGrantFromGrantState(
  grants: OrganizationContainerGrants | null,
  revokedGrant: OrganizationContainerGrant,
): OrganizationContainerGrants | null {
  return grants
    ? {
        ...grants,
        grants: removeRevokedGrantRows(grants.grants, revokedGrant),
      }
    : grants;
}

export function removeRevokedGrantFromGroupContainers(
  groupContainers: OrganizationGroupContainers | null,
  revokedGrant: OrganizationContainerGrant,
): OrganizationGroupContainers | null {
  if (
    !groupContainers ||
    revokedGrant.subjectType !== "group" ||
    groupContainers.groupId !== revokedGrant.subjectId
  ) {
    return groupContainers;
  }

  return {
    ...groupContainers,
    containers: groupContainers.containers.filter(
      (container) => container.containerId !== revokedGrant.containerId,
    ),
  };
}

export function removeRevokedGrantFromUserDetail(
  userDetail: OrganizationUserDetail | null,
  revokedGrant: OrganizationContainerGrant,
): OrganizationUserDetail | null {
  return userDetail
    ? {
        ...userDetail,
        grants: {
          directGrants: removeRevokedGrantRows(
            userDetail.grants.directGrants,
            revokedGrant,
          ),
          groupGrants: removeRevokedGrantRows(
            userDetail.grants.groupGrants,
            revokedGrant,
          ),
        },
      }
    : userDetail;
}
