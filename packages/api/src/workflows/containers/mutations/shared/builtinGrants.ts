import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import { containerBuiltinGrants } from "@tearleads/api-shared/schema";
import type {
  ContainerDirectGrant,
  ContainerGrantSubjectType,
  KeyingCanonicalJson,
  VerifiedContainerAccessManifest,
} from "@tearleads/crypto";
import { and, eq } from "drizzle-orm";
import { ContainerMutationError } from "../errors";

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

export async function assertContainerBuiltinGrantPolicyPreserved(input: {
  readonly executor: DatabaseTransaction;
  readonly manifest: VerifiedContainerAccessManifest;
  readonly previousManifest: VerifiedContainerAccessManifest | null;
}): Promise<void> {
  const mutation = readBuiltinGrantMutation(input.manifest);
  if (!mutation) {
    return;
  }

  const [builtinGrant] = await input.executor
    .select({ accessLevel: containerBuiltinGrants.accessLevel })
    .from(containerBuiltinGrants)
    .where(
      and(
        eq(
          containerBuiltinGrants.organizationId,
          input.manifest.state.organizationId,
        ),
        eq(
          containerBuiltinGrants.containerId,
          input.manifest.state.containerId,
        ),
        eq(containerBuiltinGrants.subjectType, mutation.subjectType),
        eq(containerBuiltinGrants.subjectId, mutation.subjectId),
      ),
    )
    .limit(1);

  if (!builtinGrant) {
    return;
  }

  if (
    mutation.eventType === "container.grant" &&
    mutation.accessLevel === builtinGrant.accessLevel &&
    input.previousManifest?.state.directGrants.some(
      (grant) =>
        grant.subjectType === mutation.subjectType &&
        grant.subjectId === mutation.subjectId &&
        grant.accessLevel === builtinGrant.accessLevel,
    )
  ) {
    return;
  }

  throw new ContainerMutationError(
    "Built-in container grant cannot be revoked or change access level",
    403,
  );
}
