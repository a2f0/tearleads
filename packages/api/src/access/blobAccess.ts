import { and, eq, isNull } from "drizzle-orm";
import { type DatabaseExecutor, db } from "../adapters/postgres";
import { attachmentBindings } from "../schema";
import { uniqueSortedStrings } from "../utils/array";
import {
  computeAccessFingerprint,
  computeAccessStateHash,
} from "./accessFingerprint";
import { resolveDocumentAccessState } from "./documentAccess";
import {
  type EffectivePrincipalRecipient,
  isUserPrincipalRecipient,
  mergeAccessLevel,
  principalRecipientKey,
  toPrincipalFingerprintRecipient,
} from "./recipientPrincipals";

const BLOB_OBJECT_TYPE = "blob";

type BlobAccessExecutor = DatabaseExecutor;
type ResolvedDocumentAccessState = Awaited<
  ReturnType<typeof resolveDocumentAccessState>
>;

type EffectiveBlobRecipient = EffectivePrincipalRecipient;

interface BlobAccessState {
  currentAccessEpoch: number;
  accessFingerprint: string;
  accessStateHash: string;
  effectiveRecipients: EffectiveBlobRecipient[];
  cryptoRecipients: EffectiveBlobRecipient[];
}

function isResolvedDocumentAccessState(
  value: ResolvedDocumentAccessState,
): value is Exclude<ResolvedDocumentAccessState, null> {
  return value !== null;
}

async function listLinkedDocumentIds(
  blobId: string,
  executor: BlobAccessExecutor = db,
): Promise<string[]> {
  const rows = await executor
    .select({ documentId: attachmentBindings.documentId })
    .from(attachmentBindings)
    .where(
      and(
        eq(attachmentBindings.blobId, blobId),
        isNull(attachmentBindings.detachedAt),
      ),
    );

  return uniqueSortedStrings(rows.map((row) => row.documentId));
}

async function resolveBlobAccessInputs(
  blobId: string,
  executor: BlobAccessExecutor = db,
) {
  const linkedDocumentIds = await listLinkedDocumentIds(blobId, executor);
  const resolvedLinkedDocumentStates = await Promise.all(
    linkedDocumentIds.map((documentId) =>
      resolveDocumentAccessState(documentId, executor),
    ),
  );
  const linkedDocumentStates = resolvedLinkedDocumentStates.filter(
    isResolvedDocumentAccessState,
  );

  const recipientsByPrincipalKey = new Map<string, EffectiveBlobRecipient>();
  const cryptoRecipientsByPrincipalKey = new Map<
    string,
    EffectiveBlobRecipient
  >();

  for (const state of linkedDocumentStates) {
    for (const recipient of state.effectiveRecipients) {
      const principalKey = principalRecipientKey(recipient);
      const existing = recipientsByPrincipalKey.get(principalKey);
      recipientsByPrincipalKey.set(principalKey, {
        principalType: recipient.principalType,
        principalId: recipient.principalId,
        accessLevel: existing
          ? mergeAccessLevel(existing.accessLevel, recipient.accessLevel)
          : recipient.accessLevel,
        encapsulationPublicKey: recipient.encapsulationPublicKey,
        keyFingerprint: recipient.keyFingerprint,
      });
    }

    for (const recipient of state.cryptoRecipients) {
      const principalKey = principalRecipientKey(recipient);
      const existing = cryptoRecipientsByPrincipalKey.get(principalKey);
      cryptoRecipientsByPrincipalKey.set(principalKey, {
        principalType: recipient.principalType,
        principalId: recipient.principalId,
        accessLevel: existing
          ? mergeAccessLevel(existing.accessLevel, recipient.accessLevel)
          : recipient.accessLevel,
        encapsulationPublicKey: recipient.encapsulationPublicKey,
        keyFingerprint: recipient.keyFingerprint,
      });
    }
  }

  const effectiveRecipients = Array.from(
    recipientsByPrincipalKey.values(),
  ).sort((left, right) =>
    left.keyFingerprint.localeCompare(right.keyFingerprint),
  );
  const cryptoRecipients = Array.from(
    cryptoRecipientsByPrincipalKey.values(),
  ).sort((left, right) =>
    left.keyFingerprint.localeCompare(right.keyFingerprint),
  );

  return {
    linkedDocumentIds,
    linkedDocumentStates,
    hasUnavailableLinkedDocuments:
      linkedDocumentStates.length !== linkedDocumentIds.length,
    effectiveRecipients,
    cryptoRecipients,
  };
}

async function computeBlobAccessFingerprint(input: {
  blobId: string;
  linkedDocumentIds: string[];
  linkedDocumentFingerprints: string[];
  cryptoRecipients: EffectiveBlobRecipient[];
}) {
  return computeAccessFingerprint({
    objectType: BLOB_OBJECT_TYPE,
    blobId: input.blobId,
    linkedDocumentIds: input.linkedDocumentIds,
    linkedDocumentFingerprints: input.linkedDocumentFingerprints,
    recipients: input.cryptoRecipients.map(toPrincipalFingerprintRecipient),
  });
}

async function computeBlobAccessStateHash(input: {
  blobId: string;
  linkedDocumentIds: string[];
  linkedDocumentStates: Exclude<ResolvedDocumentAccessState, null>[];
}) {
  return computeAccessStateHash({
    objectType: BLOB_OBJECT_TYPE,
    blobId: input.blobId,
    linkedDocuments: input.linkedDocumentIds.map((documentId, index) => {
      const linkedDocumentState = input.linkedDocumentStates[index];

      if (!linkedDocumentState) {
        throw new Error(
          `Invariant violation: linked document state missing for ${documentId}`,
        );
      }

      return {
        documentId,
        accessStateHash: linkedDocumentState.accessStateHash,
      };
    }),
  });
}

export async function resolveBlobAccessState(
  blobId: string,
  executor: BlobAccessExecutor = db,
): Promise<BlobAccessState | null> {
  const {
    linkedDocumentIds,
    linkedDocumentStates,
    hasUnavailableLinkedDocuments,
    effectiveRecipients,
    cryptoRecipients,
  } = await resolveBlobAccessInputs(blobId, executor);

  if (hasUnavailableLinkedDocuments) {
    return null;
  }

  if (linkedDocumentStates.length === 0) {
    return null;
  }

  const accessFingerprint = await computeBlobAccessFingerprint({
    blobId,
    linkedDocumentIds,
    linkedDocumentFingerprints: linkedDocumentStates.map(
      (state) => state.accessFingerprint,
    ),
    cryptoRecipients,
  });
  const accessStateHash = await computeBlobAccessStateHash({
    blobId,
    linkedDocumentIds,
    linkedDocumentStates,
  });
  const currentAccessEpoch = Math.max(
    1,
    ...linkedDocumentStates.map((state) => state.currentAccessEpoch),
  );

  return {
    currentAccessEpoch,
    accessFingerprint,
    accessStateHash,
    effectiveRecipients,
    cryptoRecipients,
  };
}

export function canReadBlobAccess(
  state: BlobAccessState,
  userId: string,
): boolean {
  return state.effectiveRecipients.some((recipient) =>
    isUserPrincipalRecipient(recipient, userId),
  );
}

export async function attachBlobToDocument(
  blobId: string,
  documentId: string,
  slotId: string,
): Promise<void> {
  return db.transaction(async (tx) => {
    const [existingBinding] = await tx
      .select({ id: attachmentBindings.id })
      .from(attachmentBindings)
      .where(
        and(
          eq(attachmentBindings.documentId, documentId),
          eq(attachmentBindings.slotId, slotId),
          isNull(attachmentBindings.detachedAt),
        ),
      )
      .limit(1);

    if (existingBinding) {
      await tx
        .update(attachmentBindings)
        .set({ detachedAt: new Date() })
        .where(eq(attachmentBindings.id, existingBinding.id));
    }

    await tx.insert(attachmentBindings).values({
      blobId,
      documentId,
      slotId,
      previousBindingId: existingBinding?.id ?? null,
    });
  });
}
