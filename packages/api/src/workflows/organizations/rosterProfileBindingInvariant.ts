import type { DatabaseSession } from "@symcrypt/api-shared/postgres";
import {
  containers,
  organizationRosterEntries,
} from "@symcrypt/api-shared/schema";
import type { VerifiedDocumentLinkSetManifest } from "@symcrypt/crypto";
import { deriveOrganizationRosterProfileContainerSystemSlot } from "@symcrypt/validators/containerSystemSlot";
import { and, eq, inArray } from "drizzle-orm";
import { DocumentMutationError } from "../documents/mutations/errors";

export async function assertRosterProfileDocumentUnbound(input: {
  readonly documentId: string;
  readonly executor: DatabaseSession;
}): Promise<void> {
  const [binding] = await input.executor
    .select({ id: organizationRosterEntries.id })
    .from(organizationRosterEntries)
    .where(eq(organizationRosterEntries.profileDocumentId, input.documentId))
    .limit(1);
  if (binding) {
    throw new DocumentMutationError(
      "Bound roster profile documents cannot be purged",
      409,
    );
  }
}

export async function assertRosterProfileBindingPreserved(input: {
  readonly executor: DatabaseSession;
  readonly manifest: VerifiedDocumentLinkSetManifest;
}): Promise<void> {
  const { documentId, linkedContainerIds, organizationId } =
    input.manifest.state;
  const bindings = await input.executor
    .select({ organizationId: organizationRosterEntries.organizationId })
    .from(organizationRosterEntries)
    .where(eq(organizationRosterEntries.profileDocumentId, documentId));
  if (bindings.length === 0) {
    return;
  }
  if (bindings.some((binding) => binding.organizationId !== organizationId)) {
    throw new DocumentMutationError(
      "Roster profile document organization mismatch",
      409,
    );
  }

  const systemSlot = await deriveOrganizationRosterProfileContainerSystemSlot({
    organizationId,
  });
  const [rosterContainer] = await input.executor
    .select({ id: containers.id })
    .from(containers)
    .where(
      and(
        inArray(containers.id, linkedContainerIds),
        eq(containers.organizationId, organizationId),
        eq(containers.systemSlot, systemSlot),
      ),
    )
    .limit(1);
  if (!rosterContainer || linkedContainerIds.length !== 1) {
    throw new DocumentMutationError(
      "Bound roster profile documents must remain exclusively in the roster profile container",
      409,
    );
  }
}
