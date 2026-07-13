import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import {
  organizationRosterEntries,
  organizations,
} from "@tearleads/api-shared/schema";
import {
  type DocumentCreateRequest,
  isProvisionedDocumentRequest,
  type OrganizationProvisioningRequest,
} from "@tearleads/validators/request";
import type { ContainerCreateWithMetadataDocumentResponse } from "@tearleads/validators/response";
import { and, eq } from "drizzle-orm";
import { createDocumentWithExecutor } from "../documents/mutations";
import { appendProvisionedDocumentInitialUpdate } from "../documents/mutations/syncDocument";
import { OrganizationProvisioningError } from "./provisionOrganizationError";

interface ProfileProvisioningSigner {
  readonly fingerprint: string;
  readonly signingPublicKey: Uint8Array;
}

export function readDocumentCreateRequestId(
  request: DocumentCreateRequest,
): string {
  const documentId = Reflect.get(request.event, "objectId");
  return typeof documentId === "string" && documentId.length > 0
    ? documentId
    : "";
}

function readDocumentLinkedContainerIds(
  document: Awaited<ReturnType<typeof createDocumentWithExecutor>>,
): string[] {
  const state = document.accessManifest?.state;
  if (!state || typeof state !== "object") {
    return [];
  }
  const linkedContainerIds = Reflect.get(state, "linkedContainerIds");
  return Array.isArray(linkedContainerIds)
    ? linkedContainerIds.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
}

export async function createInitialRosterProfileDocument(
  tx: DatabaseTransaction,
  input: OrganizationProvisioningRequest,
  signer: ProfileProvisioningSigner,
  profileContainer:
    | ContainerCreateWithMetadataDocumentResponse["container"]
    | null,
) {
  if (!input.initialRosterProfileDocument) {
    return null;
  }
  if (!profileContainer) {
    throw new OrganizationProvisioningError(
      "Initial roster profile document requires a profile container",
      400,
    );
  }

  const requestDocumentId = readDocumentCreateRequestId(
    input.initialRosterProfileDocument,
  );
  if (!requestDocumentId) {
    throw new OrganizationProvisioningError(
      "Initial roster profile document id is unavailable",
      400,
    );
  }

  const created = await createDocumentWithExecutor({
    executor: tx,
    fingerprint: signer.fingerprint,
    request: input.initialRosterProfileDocument,
    userId: input.userId,
  });
  if (created.id !== requestDocumentId) {
    throw new OrganizationProvisioningError(
      "Initial roster profile response does not match request",
      400,
    );
  }
  const linkedContainerIds = readDocumentLinkedContainerIds(created);
  if (
    linkedContainerIds.length !== 1 ||
    linkedContainerIds[0] !== profileContainer.containerId
  ) {
    throw new OrganizationProvisioningError(
      "Initial roster profile document does not match roster profile container",
      400,
    );
  }

  if (isProvisionedDocumentRequest(input.initialRosterProfileDocument)) {
    await appendProvisionedDocumentInitialUpdate({
      documentId: created.id,
      executor: tx,
      fingerprint: signer.fingerprint,
      request: input.initialRosterProfileDocument.initialSync,
      signingPublicKey: signer.signingPublicKey,
      userId: input.userId,
    });
  }

  const [rosterEntry] = await tx
    .update(organizationRosterEntries)
    .set({ profileDocumentId: created.id, updatedAt: new Date() })
    .where(
      and(
        eq(organizationRosterEntries.organizationId, input.organizationId),
        eq(organizationRosterEntries.userId, input.userId),
      ),
    )
    .returning({
      profileDocumentId: organizationRosterEntries.profileDocumentId,
    });

  if (!rosterEntry) {
    throw new OrganizationProvisioningError(
      "Initial roster entry not found",
      500,
    );
  }
  return created;
}

export async function createInitialOrganizationProfileDocument(
  tx: DatabaseTransaction,
  input: OrganizationProvisioningRequest,
  signer: ProfileProvisioningSigner,
  profileContainer:
    | ContainerCreateWithMetadataDocumentResponse["container"]
    | null,
) {
  if (!input.initialOrganizationProfileDocument) {
    return null;
  }
  if (!profileContainer) {
    throw new OrganizationProvisioningError(
      "Initial organization profile document requires a profile container",
      400,
    );
  }

  const requestDocumentId = readDocumentCreateRequestId(
    input.initialOrganizationProfileDocument,
  );
  if (!requestDocumentId) {
    throw new OrganizationProvisioningError(
      "Initial organization profile document id is unavailable",
      400,
    );
  }

  const created = await createDocumentWithExecutor({
    executor: tx,
    fingerprint: signer.fingerprint,
    request: input.initialOrganizationProfileDocument,
    userId: input.userId,
  });
  if (created.id !== requestDocumentId) {
    throw new OrganizationProvisioningError(
      "Initial organization profile response does not match request",
      400,
    );
  }
  const linkedContainerIds = readDocumentLinkedContainerIds(created);
  if (
    linkedContainerIds.length !== 1 ||
    linkedContainerIds[0] !== profileContainer.containerId
  ) {
    throw new OrganizationProvisioningError(
      "Initial organization profile document does not match organization metadata container",
      400,
    );
  }

  if (isProvisionedDocumentRequest(input.initialOrganizationProfileDocument)) {
    await appendProvisionedDocumentInitialUpdate({
      documentId: created.id,
      executor: tx,
      fingerprint: signer.fingerprint,
      request: input.initialOrganizationProfileDocument.initialSync,
      signingPublicKey: signer.signingPublicKey,
      userId: input.userId,
    });
  }

  const [organization] = await tx
    .update(organizations)
    .set({ profileDocumentId: created.id })
    .where(eq(organizations.id, input.organizationId))
    .returning({ profileDocumentId: organizations.profileDocumentId });
  if (!organization) {
    throw new OrganizationProvisioningError(
      "Initial organization not found",
      500,
    );
  }
  return created;
}
