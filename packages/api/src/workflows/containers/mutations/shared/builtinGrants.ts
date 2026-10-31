import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import type {
  ContainerDirectGrant,
  ContainerGrantSubjectType,
  KeyingCanonicalJson,
  VerifiedContainerAccessManifest,
} from "@tearleads/crypto";
import { ContainerMutationError } from "../errors";
import {
  assertOrganizationMetadataRoot,
  isOrganizationMetadataRootState,
  loadOrganizationBuiltinGrantSubjects,
  type OrganizationBuiltinGrantSubjects,
} from "./organizationMetadataRoot";

type ContainerMutationSubject = Pick<
  ContainerDirectGrant,
  "subjectId" | "subjectType"
>;

type ContainerBuiltinGrantMutation =
  | (ContainerMutationSubject & {
      readonly accessLevel: ContainerDirectGrant["accessLevel"];
      readonly eventType: "container.grant";
    })
  | (ContainerMutationSubject & {
      readonly eventType: "container.revoke";
    });

function isCanonicalRecord(
  value: KeyingCanonicalJson,
): value is { readonly [key: string]: KeyingCanonicalJson } {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isContainerGrantSubjectType(
  value: unknown,
): value is ContainerGrantSubjectType {
  return value === "group" || value === "user";
}

function isContainerAccessLevel(
  value: unknown,
): value is ContainerDirectGrant["accessLevel"] {
  return value === "admin" || value === "read" || value === "write";
}

function isContainerMutationSubject(
  value: unknown,
): value is ContainerMutationSubject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const subjectId = Reflect.get(value, "subjectId");
  const subjectType = Reflect.get(value, "subjectType");
  return (
    typeof subjectId === "string" && isContainerGrantSubjectType(subjectType)
  );
}

function readBuiltinGrantMutation(
  manifest: VerifiedContainerAccessManifest,
): ContainerBuiltinGrantMutation | null {
  const { body } = manifest.event;

  if (!isCanonicalRecord(body)) {
    return null;
  }

  if (manifest.event.event.eventType === "container.grant") {
    const grant = Reflect.get(body, "grant");
    if (!isContainerMutationSubject(grant)) {
      return null;
    }
    const accessLevel = Reflect.get(grant, "accessLevel");
    if (!isContainerAccessLevel(accessLevel)) {
      return null;
    }

    return {
      accessLevel,
      eventType: "container.grant",
      subjectId: grant.subjectId,
      subjectType: grant.subjectType,
    };
  }

  if (manifest.event.event.eventType === "container.revoke") {
    if (!isContainerMutationSubject(body)) {
      return null;
    }

    return {
      eventType: "container.revoke",
      subjectId: body.subjectId,
      subjectType: body.subjectType,
    };
  }

  return null;
}

/**
 * Built-in grants are derived, not stored: the Admins group at admin on the
 * organization root, and on the derived metadata slot the Admins group at
 * admin and the Members group at read. Returns the fixed level, or null when
 * the subject holds no built-in grant on the container.
 */
export function builtinContainerGrantAccessLevel(input: {
  readonly containerId: string;
  readonly isMetadataRoot: boolean;
  readonly organization: OrganizationBuiltinGrantSubjects;
  readonly subject: ContainerMutationSubject;
}): ContainerDirectGrant["accessLevel"] | null {
  const { organization, subject } = input;
  if (subject.subjectType !== "group") return null;
  if (input.isMetadataRoot) {
    if (subject.subjectId === organization.adminGroupId) return "admin";
    if (subject.subjectId === organization.memberGroupId) return "read";
    return null;
  }
  return input.containerId === organization.rootContainerId &&
    subject.subjectId === organization.adminGroupId
    ? "admin"
    : null;
}

export async function assertContainerBuiltinGrantPolicyPreserved(input: {
  readonly executor: DatabaseTransaction;
  readonly manifest: VerifiedContainerAccessManifest;
  readonly previousManifest: VerifiedContainerAccessManifest | null;
}): Promise<void> {
  const { state } = input.manifest;
  const isMetadataRoot = await isOrganizationMetadataRootState(state);
  const mutation = readBuiltinGrantMutation(input.manifest);
  // Built-in subjects are always groups, so only a group grant or revoke, or
  // any metadata-root mutation, reads the organization's facts.
  if (!isMetadataRoot && mutation?.subjectType !== "group") {
    return;
  }

  const organization = await loadOrganizationBuiltinGrantSubjects(
    input.executor,
    state.organizationId,
  );
  if (isMetadataRoot) {
    assertOrganizationMetadataRoot(organization, state);
  }
  if (!mutation || !organization) {
    return;
  }

  const builtinAccessLevel = builtinContainerGrantAccessLevel({
    containerId: state.containerId,
    isMetadataRoot,
    organization,
    subject: mutation,
  });
  if (builtinAccessLevel === null) {
    return;
  }

  if (
    mutation.eventType === "container.grant" &&
    mutation.accessLevel === builtinAccessLevel &&
    input.previousManifest?.state.directGrants.some(
      (grant) =>
        grant.subjectType === mutation.subjectType &&
        grant.subjectId === mutation.subjectId &&
        grant.accessLevel === builtinAccessLevel,
    )
  ) {
    return;
  }

  throw new ContainerMutationError(
    "Built-in container grant cannot be revoked or change access level",
    403,
  );
}
