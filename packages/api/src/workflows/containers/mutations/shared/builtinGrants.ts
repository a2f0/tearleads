import type { VerifiedContainerAccessManifest } from "@tearleads/crypto";
import { and, eq } from "drizzle-orm";
import type { DatabaseTransaction } from "../../../../adapters/postgres";
import { containerBuiltinGrants } from "../../../../schema";
import { ContainerMutationError } from "../errors";

function readMutationSubject(manifest: VerifiedContainerAccessManifest): {
  readonly subjectId: string;
  readonly subjectType: string;
} | null {
  const { body } = manifest.event;

  if (
    manifest.event.event.eventType === "container.grant" &&
    body &&
    typeof body === "object" &&
    "grant" in body
  ) {
    const grant = Reflect.get(body, "grant");
    if (!grant || typeof grant !== "object") {
      return null;
    }

    const subjectId = Reflect.get(grant, "subjectId");
    const subjectType = Reflect.get(grant, "subjectType");

    return typeof subjectId === "string" && typeof subjectType === "string"
      ? { subjectId, subjectType }
      : null;
  }

  if (
    manifest.event.event.eventType === "container.revoke" &&
    body &&
    typeof body === "object"
  ) {
    const subjectId = Reflect.get(body, "subjectId");
    const subjectType = Reflect.get(body, "subjectType");

    return typeof subjectId === "string" && typeof subjectType === "string"
      ? { subjectId, subjectType }
      : null;
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
