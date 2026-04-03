import { and, desc, eq } from "drizzle-orm";
import { db } from "../adapters/postgres";
import {
  documentContainerLinks,
  objectAccessEpochs,
  objectRecipientEnvelopes,
} from "../schema";
import { computeAccessFingerprint } from "./accessFingerprint";
import { resolveContainerAccessState } from "./containerAccess";

const DOCUMENT_OBJECT_TYPE = "document";

type AccessLevel = "read" | "write" | "admin";
type DocumentAccessTransaction = Parameters<
  (typeof db)["transaction"]
>[0] extends (tx: infer T) => Promise<unknown>
  ? T
  : never;
type DocumentAccessExecutor = typeof db | DocumentAccessTransaction;

interface GrantRow {
  subjectType: string;
  subjectId: string;
  accessLevel: string;
}

interface EffectiveDocumentRecipient {
  userId: string;
  accessLevel: AccessLevel;
  encapsulationPublicKey: string;
  keyFingerprint: string;
}

interface DocumentAccessState {
  currentAccessEpoch: number;
  accessFingerprint: string;
  effectiveRecipients: EffectiveDocumentRecipient[];
}

function accessLevelRank(accessLevel: AccessLevel): number {
  if (accessLevel === "admin") {
    return 3;
  }

  if (accessLevel === "write") {
    return 2;
  }

  return 1;
}

function mergeAccessLevel(
  current: AccessLevel | undefined,
  incoming: AccessLevel,
): AccessLevel {
  if (!current) {
    return incoming;
  }

  return accessLevelRank(incoming) > accessLevelRank(current)
    ? incoming
    : current;
}

function uniqueSortedStrings(values: string[]): string[] {
  return Array.from(new Set(values)).sort((left, right) =>
    left.localeCompare(right),
  );
}

async function getCurrentEpoch(
  documentId: string,
  executor: DocumentAccessExecutor = db,
) {
  const [row] = await executor
    .select({
      epoch: objectAccessEpochs.epoch,
      accessFingerprint: objectAccessEpochs.accessFingerprint,
    })
    .from(objectAccessEpochs)
    .where(
      and(
        eq(objectAccessEpochs.objectType, DOCUMENT_OBJECT_TYPE),
        eq(objectAccessEpochs.objectId, documentId),
      ),
    )
    .orderBy(desc(objectAccessEpochs.epoch))
    .limit(1);

  return row ?? null;
}

async function listLinkedContainerIds(
  documentId: string,
  executor: DocumentAccessExecutor = db,
): Promise<string[]> {
  const rows = await executor
    .select({ containerId: documentContainerLinks.containerId })
    .from(documentContainerLinks)
    .where(eq(documentContainerLinks.documentId, documentId));

  return uniqueSortedStrings(rows.map((row) => row.containerId));
}

async function resolveDocumentRecipientsFromLinkedContainers(
  documentId: string,
  executor: DocumentAccessExecutor = db,
) {
  const linkedContainerIds = await listLinkedContainerIds(documentId, executor);
  const linkedContainerStates = (
    await Promise.all(
      linkedContainerIds.map((containerId) =>
        resolveContainerAccessState(containerId, executor),
      ),
    )
  ).filter((state) => state !== null);

  const recipientsByUserId = new Map<string, EffectiveDocumentRecipient>();

  for (const state of linkedContainerStates) {
    for (const recipient of state.effectiveRecipients) {
      const existing = recipientsByUserId.get(recipient.userId);
      recipientsByUserId.set(recipient.userId, {
        userId: recipient.userId,
        accessLevel: existing
          ? mergeAccessLevel(existing.accessLevel, recipient.accessLevel)
          : recipient.accessLevel,
        encapsulationPublicKey: recipient.encapsulationPublicKey,
        keyFingerprint: recipient.keyFingerprint,
      });
    }
  }

  const effectiveRecipients = Array.from(recipientsByUserId.values()).sort(
    (left, right) => left.keyFingerprint.localeCompare(right.keyFingerprint),
  );

  return {
    linkedContainerIds,
    linkedContainerStates,
    effectiveRecipients,
  };
}

async function resolveDocumentAccessInputs(
  documentId: string,
  executor: DocumentAccessExecutor = db,
) {
  const grants: GrantRow[] = [];
  const {
    linkedContainerIds,
    linkedContainerStates,
    effectiveRecipients: linkedContainerRecipients,
  } = await resolveDocumentRecipientsFromLinkedContainers(documentId, executor);

  return {
    linkedContainerIds,
    linkedContainerStates,
    grants,
    effectiveRecipients: linkedContainerRecipients,
  };
}

async function computeDocumentAccessFingerprint(input: {
  documentId: string;
  grants: GrantRow[];
  linkedContainerIds: string[];
  linkedContainerFingerprints: string[];
  effectiveRecipients: EffectiveDocumentRecipient[];
}) {
  return computeAccessFingerprint({
    objectType: DOCUMENT_OBJECT_TYPE,
    documentId: input.documentId,
    linkedContainerIds: input.linkedContainerIds,
    linkedContainerFingerprints: input.linkedContainerFingerprints,
    grants: input.grants
      .map((grant) => ({
        subjectType: grant.subjectType,
        subjectId: grant.subjectId,
        accessLevel: grant.accessLevel,
      }))
      .sort((left, right) =>
        JSON.stringify(left).localeCompare(JSON.stringify(right)),
      ),
    recipients: input.effectiveRecipients.map((recipient) => ({
      userId: recipient.userId,
      accessLevel: recipient.accessLevel,
      keyFingerprint: recipient.keyFingerprint,
    })),
  });
}

export async function resolveDocumentAccessState(
  documentId: string,
  executor: DocumentAccessExecutor = db,
): Promise<DocumentAccessState | null> {
  const currentEpochRow = await getCurrentEpoch(documentId, executor);
  const {
    linkedContainerIds,
    linkedContainerStates,
    grants,
    effectiveRecipients,
  } = await resolveDocumentAccessInputs(documentId, executor);

  if (currentEpochRow === null && linkedContainerStates.length === 0) {
    return null;
  }
  const accessFingerprint = await computeDocumentAccessFingerprint({
    documentId,
    grants,
    linkedContainerIds,
    linkedContainerFingerprints: linkedContainerStates.map(
      (state) => state.accessFingerprint,
    ),
    effectiveRecipients,
  });

  const currentAccessEpoch = Math.max(
    currentEpochRow?.epoch ?? 1,
    ...linkedContainerStates.map((state) => state.currentAccessEpoch),
  );

  return {
    currentAccessEpoch,
    accessFingerprint,
    effectiveRecipients,
  };
}

export function canReadDocumentAccess(
  state: DocumentAccessState,
  userId: string,
): boolean {
  return state.effectiveRecipients.some(
    (recipient) => recipient.userId === userId,
  );
}

export function canWriteDocumentAccess(
  state: DocumentAccessState,
  userId: string,
): boolean {
  return state.effectiveRecipients.some(
    (recipient) =>
      recipient.userId === userId &&
      accessLevelRank(recipient.accessLevel) >= accessLevelRank("write"),
  );
}

export function listRecipientKeyFingerprints(
  state: DocumentAccessState,
): string[] {
  return state.effectiveRecipients.map((recipient) => recipient.keyFingerprint);
}

export function listRecipientEncapsulationPublicKeys(
  state: DocumentAccessState,
): string[] {
  return state.effectiveRecipients.map(
    (recipient) => recipient.encapsulationPublicKey,
  );
}

async function replaceRecipientEnvelopes(
  documentId: string,
  epoch: number,
  recipients: EffectiveDocumentRecipient[],
  executor: DocumentAccessExecutor = db,
) {
  await executor
    .delete(objectRecipientEnvelopes)
    .where(
      and(
        eq(objectRecipientEnvelopes.objectType, DOCUMENT_OBJECT_TYPE),
        eq(objectRecipientEnvelopes.objectId, documentId),
        eq(objectRecipientEnvelopes.epoch, epoch),
      ),
    );

  if (recipients.length === 0) {
    return;
  }

  await executor.insert(objectRecipientEnvelopes).values(
    recipients.map((recipient) => ({
      objectType: DOCUMENT_OBJECT_TYPE,
      objectId: documentId,
      epoch,
      recipientUserId: recipient.userId,
      recipientKeyFingerprint: recipient.keyFingerprint,
    })),
  );
}

async function writeEpoch(
  documentId: string,
  epoch: number,
  accessFingerprint: string,
  executor: DocumentAccessExecutor = db,
) {
  await executor.insert(objectAccessEpochs).values({
    objectType: DOCUMENT_OBJECT_TYPE,
    objectId: documentId,
    epoch,
    accessFingerprint,
    updatedAt: new Date(),
  });
}

export async function initializeDocumentAccess(
  documentId: string,
): Promise<number> {
  return db.transaction(async (tx) => {
    const {
      linkedContainerIds,
      linkedContainerStates,
      grants,
      effectiveRecipients,
    } = await resolveDocumentAccessInputs(documentId, tx);
    const accessFingerprint = await computeDocumentAccessFingerprint({
      documentId,
      grants,
      linkedContainerIds,
      linkedContainerFingerprints: linkedContainerStates.map(
        (state) => state.accessFingerprint,
      ),
      effectiveRecipients,
    });
    const initialEpoch = Math.max(
      1,
      ...linkedContainerStates.map((state) => state.currentAccessEpoch),
    );

    await writeEpoch(documentId, initialEpoch, accessFingerprint, tx);

    await replaceRecipientEnvelopes(
      documentId,
      initialEpoch,
      effectiveRecipients,
      tx,
    );

    return initialEpoch;
  });
}
