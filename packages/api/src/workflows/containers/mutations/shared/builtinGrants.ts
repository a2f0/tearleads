import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import type {
  ContainerDirectGrant,
  VerifiedContainerAccessManifest,
} from "@tearleads/crypto";
import { z } from "zod";
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

const grantSubjectShape = {
  subjectId: z.string(),
  subjectType: z.enum(["group", "user"]),
};

const grantBodySchema = z.object({
  grant: z.object({
    ...grantSubjectShape,
    accessLevel: z.enum(["admin", "read", "write"]),
  }),
});

const revokeBodySchema = z.object(grantSubjectShape);

function readBuiltinGrantMutation(
  manifest: VerifiedContainerAccessManifest,
): ContainerBuiltinGrantMutation | null {
  const { body } = manifest.event;

  if (manifest.event.event.eventType === "container.grant") {
    const parsed = grantBodySchema.safeParse(body);
    if (!parsed.success) {
      return null;
    }
    const { grant } = parsed.data;

    return {
      accessLevel: grant.accessLevel,
      eventType: "container.grant",
      subjectId: grant.subjectId,
      subjectType: grant.subjectType,
    };
  }

  if (manifest.event.event.eventType === "container.revoke") {
    const parsed = revokeBodySchema.safeParse(body);
    if (!parsed.success) {
      return null;
    }

    return {
      eventType: "container.revoke",
      subjectId: parsed.data.subjectId,
      subjectType: parsed.data.subjectType,
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
function builtinContainerGrantAccessLevel(input: {
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
