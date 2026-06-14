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

function isCanonicalRecord(
  value: KeyingCanonicalJson,
): value is { readonly [key: string]: KeyingCanonicalJson } {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isContainerGrantSubjectType(
  value: unknown,
): value is ContainerGrantSubjectType {
  return value === "group" || value === "organization" || value === "user";
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

function readMutationSubject(
  manifest: VerifiedContainerAccessManifest,
): ContainerMutationSubject | null {
  const { body } = manifest.event;

  if (!isCanonicalRecord(body)) {
    return null;
  }

  if (manifest.event.event.eventType === "container.grant") {
    const grant = Reflect.get(body, "grant");
    if (!isContainerMutationSubject(grant)) {
      return null;
    }

    return { subjectId: grant.subjectId, subjectType: grant.subjectType };
  }

  if (manifest.event.event.eventType === "container.revoke") {
    if (!isContainerMutationSubject(body)) {
      return null;
    }

    return {
      subjectId: body.subjectId,
      subjectType: body.subjectType,
    };
  }

  return null;
}

export async function assertContainerBuiltinGrantNotMutated(input: {
  readonly executor: DatabaseTransaction;
  readonly manifest: VerifiedContainerAccessManifest;
}): Promise<void> {
  const subject = readMutationSubject(input.manifest);
  if (!subject) {
    return;
  }

  const [builtinGrant] = await input.executor
    .select({ id: containerBuiltinGrants.id })
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
        eq(containerBuiltinGrants.subjectType, subject.subjectType),
        eq(containerBuiltinGrants.subjectId, subject.subjectId),
      ),
    )
    .limit(1);

  if (builtinGrant) {
    throw new ContainerMutationError(
      "Built-in container grant cannot be modified",
      403,
    );
  }
}
