import type {
  OrgManagerContainerGrant,
  OrgManagerContainerGrants,
  OrgManagerGroupContainers,
  OrgManagerUserDetail,
} from "../../stores/org-manager/OrgManagerProvider";

function isSameGrantSubject(
  left: OrgManagerContainerGrant,
  right: OrgManagerContainerGrant,
): boolean {
  return (
    left.subjectType === right.subjectType && left.subjectId === right.subjectId
  );
}

function isSameContainerGrant(
  left: OrgManagerContainerGrant,
  right: OrgManagerContainerGrant,
): boolean {
  return (
    left.containerId === right.containerId && isSameGrantSubject(left, right)
  );
}

function removeRevokedGrantRows(
  grants: ReadonlyArray<OrgManagerContainerGrant>,
  revokedGrant: OrgManagerContainerGrant,
): OrgManagerContainerGrant[] {
  return grants.filter((grant) => !isSameContainerGrant(grant, revokedGrant));
}

export function removeRevokedGrantFromGrantState(
  grants: OrgManagerContainerGrants | null,
  revokedGrant: OrgManagerContainerGrant,
): OrgManagerContainerGrants | null {
  return grants
    ? {
        ...grants,
        grants: removeRevokedGrantRows(grants.grants, revokedGrant),
      }
    : grants;
}

export function removeRevokedGrantFromGroupContainers(
  groupContainers: OrgManagerGroupContainers | null,
  revokedGrant: OrgManagerContainerGrant,
): OrgManagerGroupContainers | null {
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
  userDetail: OrgManagerUserDetail | null,
  revokedGrant: OrgManagerContainerGrant,
): OrgManagerUserDetail | null {
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
          organizationGrants: removeRevokedGrantRows(
            userDetail.grants.organizationGrants,
            revokedGrant,
          ),
        },
      }
    : userDetail;
}
