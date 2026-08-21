import type { DatabaseTransaction } from "@symcrypt/api-shared/postgres";
import {
  organizationRosterEntries,
  organizations,
} from "@symcrypt/api-shared/schema";
import type {
  DocumentCreateRequest,
  OrganizationProvisioningRequest,
  ProvisionedDocumentRequest,
} from "@symcrypt/validators/request";
import type {
  ContainerCreateWithMetadataDocumentResponse,
  DocumentCreateResponse,
} from "@symcrypt/validators/response";
import { and, eq } from "drizzle-orm";
import { createDocumentWithExecutor } from "../documents/mutations";
import { appendProvisionedDocumentInitialUpdate } from "../documents/mutations/syncDocument";
import { OrganizationProvisioningError } from "./provisionOrganizationError";

interface ProfileProvisioningSigner {
  readonly fingerprint: string;
  readonly signingPublicKey: Uint8Array;
}

type ProfileContainer =
  | ContainerCreateWithMetadataDocumentResponse["container"]
  | null;

export function readDocumentCreateRequestId(
  request: DocumentCreateRequest,
): string {
  const documentId = Reflect.get(request.event, "objectId");
  return typeof documentId === "string" && documentId.length > 0
    ? documentId
    : "";
}

function readDocumentLinkedContainerIds(
  document: DocumentCreateResponse,
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

/**
 * Creates one provisioning profile document, verifies it landed with the
 * client-declared id and is linked to exactly its profile container, and then
 * records the document id via `recordProfileDocumentId` (which returns false if
 * the row it should update is missing).
 */
async function createInitialProfileDocument(input: {
  labels: {
    containerMismatch: string;
    missingContainer: string;
    missingId: string;
    recordNotFound: string;
    responseMismatch: string;
  };
  profileContainer: ProfileContainer;
  recordProfileDocumentId: (documentId: string) => Promise<boolean>;
  request: ProvisionedDocumentRequest;
  signer: ProfileProvisioningSigner;
  tx: DatabaseTransaction;
  userId: string;
}): Promise<DocumentCreateResponse> {
  const { labels, profileContainer, request, signer, tx, userId } = input;
  if (!profileContainer) {
    throw new OrganizationProvisioningError(labels.missingContainer, 400);
  }

  const requestDocumentId = readDocumentCreateRequestId(request);
  if (!requestDocumentId) {
    throw new OrganizationProvisioningError(labels.missingId, 400);
  }

  const created = await createDocumentWithExecutor({
    executor: tx,
    fingerprint: signer.fingerprint,
    request,
    userId,
  });
  if (created.id !== requestDocumentId) {
    throw new OrganizationProvisioningError(labels.responseMismatch, 400);
  }
  const linkedContainerIds = readDocumentLinkedContainerIds(created);
  if (
    linkedContainerIds.length !== 1 ||
    linkedContainerIds[0] !== profileContainer.containerId
  ) {
    throw new OrganizationProvisioningError(labels.containerMismatch, 400);
  }

  await appendProvisionedDocumentInitialUpdate({
    documentId: created.id,
    executor: tx,
    fingerprint: signer.fingerprint,
    request: request.initialSync,
    signingPublicKey: signer.signingPublicKey,
    userId,
  });

  if (!(await input.recordProfileDocumentId(created.id))) {
    throw new OrganizationProvisioningError(labels.recordNotFound, 500);
  }
  return created;
}

export async function createInitialRosterProfileDocument(
  tx: DatabaseTransaction,
  input: OrganizationProvisioningRequest,
  signer: ProfileProvisioningSigner,
  profileContainer: ProfileContainer,
): Promise<DocumentCreateResponse | null> {
  if (!input.initialRosterProfileDocument) {
    return null;
  }

  return createInitialProfileDocument({
    labels: {
      containerMismatch:
        "Initial roster profile document does not match roster profile container",
      missingContainer:
        "Initial roster profile document requires a profile container",
      missingId: "Initial roster profile document id is unavailable",
      recordNotFound: "Initial roster entry not found",
      responseMismatch:
        "Initial roster profile response does not match request",
    },
    profileContainer,
    recordProfileDocumentId: async (documentId) => {
      const [rosterEntry] = await tx
        .update(organizationRosterEntries)
        .set({ profileDocumentId: documentId, updatedAt: new Date() })
        .where(
          and(
            eq(organizationRosterEntries.organizationId, input.organizationId),
            eq(organizationRosterEntries.userId, input.userId),
          ),
        )
        .returning({
          profileDocumentId: organizationRosterEntries.profileDocumentId,
        });
      return rosterEntry !== undefined;
    },
    request: input.initialRosterProfileDocument,
    signer,
    tx,
    userId: input.userId,
  });
}

export async function createInitialOrganizationProfileDocument(
  tx: DatabaseTransaction,
  input: OrganizationProvisioningRequest,
  signer: ProfileProvisioningSigner,
  profileContainer: ProfileContainer,
): Promise<DocumentCreateResponse | null> {
  if (!input.initialOrganizationProfileDocument) {
    return null;
  }

  return createInitialProfileDocument({
    labels: {
      containerMismatch:
        "Initial organization profile document does not match organization metadata container",
      missingContainer:
        "Initial organization profile document requires a profile container",
      missingId: "Initial organization profile document id is unavailable",
      recordNotFound: "Initial organization not found",
      responseMismatch:
        "Initial organization profile response does not match request",
    },
    profileContainer,
    recordProfileDocumentId: async (documentId) => {
      const [organization] = await tx
        .update(organizations)
        .set({ profileDocumentId: documentId })
        .where(eq(organizations.id, input.organizationId))
        .returning({ profileDocumentId: organizations.profileDocumentId });
      return organization !== undefined;
    },
    request: input.initialOrganizationProfileDocument,
    signer,
    tx,
    userId: input.userId,
  });
}
