import { wrapDekForRecipients } from "@tearleads/crypto";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import {
  DOCUMENT_RECIPIENT_ENVELOPES_CONFLICT_MESSAGE,
  type DocumentRecipientEnvelopeAction,
} from "@tearleads/loro/shared";
import type { ReferencedPrincipalStateResponse } from "@tearleads/validators/response";
import type { SerializedRecipientEnvelope } from "@tearleads/validators/util";
import { and, desc, eq, inArray } from "drizzle-orm";
import { type DatabaseExecutor, db } from "../adapters/postgres";
import {
  documentContainerLinks,
  objectAccessEpochs,
  objectRecipientEnvelopes,
} from "../schema";
import { uniqueSortedStrings } from "../utils/array";
import {
  computeAccessFingerprint,
  computeAccessStateHash,
} from "./accessFingerprint";
import { resolveContainerAccessState } from "./containerAccess";
import { mergeReferencedPrincipals } from "./principalReferences";
import {
  accessLevelRank,
  type EffectivePrincipalRecipient,
  isUserPrincipalRecipient,
  mergeAccessLevel,
  principalRecipientKey,
  toPrincipalEnvelopeRecipient,
  toPrincipalFingerprintRecipient,
} from "./recipientPrincipals";

const DOCUMENT_OBJECT_TYPE = "document";

type DocumentAccessExecutor = DatabaseExecutor;
type CurrentEpochRow = {
  epoch: number;
  accessFingerprint: string;
  accessStateHash: string | null;
};
type ResolvedContainerAccessState = Awaited<
  ReturnType<typeof resolveContainerAccessState>
>;

interface GrantRow {
  subjectType: string;
  subjectId: string;
  accessLevel: string;
}

type EffectiveDocumentRecipient = EffectivePrincipalRecipient;
type StoredDocumentRecipientEnvelopeIdentity = {
  epoch: number;
  principalId: string;
  principalType: string;
  keyFingerprint: string;
};

interface DocumentAccessState {
  currentAccessEpoch: number;
  accessFingerprint: string;
  accessStateHash: string;
  referencedPrincipals: ReferencedPrincipalStateResponse[];
  effectiveRecipients: EffectiveDocumentRecipient[];
  cryptoRecipients: EffectiveDocumentRecipient[];
}

export class DocumentRecipientEnvelopeConflictError extends Error {
  constructor() {
    super(DOCUMENT_RECIPIENT_ENVELOPES_CONFLICT_MESSAGE);
  }
}

function isResolvedContainerAccessState(
  value: ResolvedContainerAccessState,
): value is Exclude<ResolvedContainerAccessState, null> {
  return value !== null;
}

async function getCurrentEpoch(
  documentId: string,
  executor: DocumentAccessExecutor = db,
) {
  const [row] = await executor
    .select({
      epoch: objectAccessEpochs.epoch,
      accessFingerprint: objectAccessEpochs.accessFingerprint,
      accessStateHash: objectAccessEpochs.accessStateHash,
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

async function getCurrentEpochs(
  documentIds: string[],
  executor: DocumentAccessExecutor = db,
): Promise<Map<string, CurrentEpochRow>> {
  const uniqueDocumentIds = uniqueSortedStrings(documentIds);

  if (uniqueDocumentIds.length === 0) {
    return new Map();
  }

  const rows = await executor
    .select({
      documentId: objectAccessEpochs.objectId,
      epoch: objectAccessEpochs.epoch,
      accessFingerprint: objectAccessEpochs.accessFingerprint,
      accessStateHash: objectAccessEpochs.accessStateHash,
    })
    .from(objectAccessEpochs)
    .where(
      and(
        eq(objectAccessEpochs.objectType, DOCUMENT_OBJECT_TYPE),
        inArray(objectAccessEpochs.objectId, uniqueDocumentIds),
      ),
    )
    .orderBy(desc(objectAccessEpochs.epoch));

  const currentEpochByDocumentId = new Map<string, CurrentEpochRow>();

  for (const row of rows) {
    if (currentEpochByDocumentId.has(row.documentId)) {
      continue;
    }

    currentEpochByDocumentId.set(row.documentId, {
      epoch: row.epoch,
      accessFingerprint: row.accessFingerprint,
      accessStateHash: row.accessStateHash,
    });
  }

  return currentEpochByDocumentId;
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

async function listLinkedContainerIdsByDocumentId(
  documentIds: string[],
  executor: DocumentAccessExecutor = db,
): Promise<Map<string, string[]>> {
  const uniqueDocumentIds = uniqueSortedStrings(documentIds);
  const linkedContainerIdsByDocumentId = new Map<string, string[]>();

  for (const documentId of uniqueDocumentIds) {
    linkedContainerIdsByDocumentId.set(documentId, []);
  }

  if (uniqueDocumentIds.length === 0) {
    return linkedContainerIdsByDocumentId;
  }

  const rows = await executor
    .select({
      documentId: documentContainerLinks.documentId,
      containerId: documentContainerLinks.containerId,
    })
    .from(documentContainerLinks)
    .where(inArray(documentContainerLinks.documentId, uniqueDocumentIds));

  for (const row of rows) {
    linkedContainerIdsByDocumentId.get(row.documentId)?.push(row.containerId);
  }

  for (const [
    documentId,
    linkedContainerIds,
  ] of linkedContainerIdsByDocumentId) {
    linkedContainerIdsByDocumentId.set(
      documentId,
      uniqueSortedStrings(linkedContainerIds),
    );
  }

  return linkedContainerIdsByDocumentId;
}

async function resolveContainerAccessStates(
  containerIds: string[],
  executor: DocumentAccessExecutor = db,
): Promise<Map<string, ResolvedContainerAccessState>> {
  const uniqueContainerIds = uniqueSortedStrings(containerIds);
  const resolvedStates = await Promise.all(
    uniqueContainerIds.map(
      async (containerId): Promise<[string, ResolvedContainerAccessState]> => [
        containerId,
        await resolveContainerAccessState(containerId, executor),
      ],
    ),
  );

  return new Map(resolvedStates);
}

function mergeRecipientsFromLinkedContainerStates(
  recipientSelector: (
    state: Exclude<ResolvedContainerAccessState, null>,
  ) => ReadonlyArray<EffectiveDocumentRecipient>,
  linkedContainerStates: Exclude<ResolvedContainerAccessState, null>[],
): EffectiveDocumentRecipient[] {
  const recipientsByPrincipalKey = new Map<
    string,
    EffectiveDocumentRecipient
  >();

  for (const state of linkedContainerStates) {
    for (const recipient of recipientSelector(state)) {
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
  }

  return Array.from(recipientsByPrincipalKey.values()).sort((left, right) =>
    left.keyFingerprint.localeCompare(right.keyFingerprint),
  );
}

function mergeReferencedPrincipalsFromLinkedContainerStates(
  linkedContainerStates: Exclude<ResolvedContainerAccessState, null>[],
): ReferencedPrincipalStateResponse[] {
  return mergeReferencedPrincipals(linkedContainerStates);
}

async function resolveDocumentRecipientsFromLinkedContainers(
  documentId: string,
  executor: DocumentAccessExecutor = db,
  linkedContainerStateById?: ReadonlyMap<string, ResolvedContainerAccessState>,
  providedLinkedContainerIds?: string[],
) {
  const linkedContainerIds =
    providedLinkedContainerIds ??
    (await listLinkedContainerIds(documentId, executor));
  const resolvedLinkedContainerStates = await Promise.all(
    linkedContainerIds.map(
      (containerId) =>
        linkedContainerStateById?.get(containerId) ??
        resolveContainerAccessState(containerId, executor),
    ),
  );
  const linkedContainerStates = resolvedLinkedContainerStates.filter(
    isResolvedContainerAccessState,
  );
  const effectiveRecipients = mergeRecipientsFromLinkedContainerStates(
    (state) => state.effectiveRecipients,
    linkedContainerStates,
  );
  const cryptoRecipients = mergeRecipientsFromLinkedContainerStates(
    (state) => state.cryptoRecipients,
    linkedContainerStates,
  );

  return {
    linkedContainerIds,
    linkedContainerStates,
    hasUnavailableLinkedContainers:
      linkedContainerStates.length !== linkedContainerIds.length,
    referencedPrincipals: mergeReferencedPrincipalsFromLinkedContainerStates(
      linkedContainerStates,
    ),
    effectiveRecipients,
    cryptoRecipients,
  };
}

async function resolveDocumentAccessInputs(
  documentId: string,
  executor: DocumentAccessExecutor = db,
  linkedContainerStateById?: ReadonlyMap<string, ResolvedContainerAccessState>,
  providedLinkedContainerIds?: string[],
) {
  const grants: GrantRow[] = [];
  const {
    linkedContainerIds,
    linkedContainerStates,
    hasUnavailableLinkedContainers,
    referencedPrincipals,
    effectiveRecipients: linkedContainerRecipients,
    cryptoRecipients: linkedContainerCryptoRecipients,
  } = await resolveDocumentRecipientsFromLinkedContainers(
    documentId,
    executor,
    linkedContainerStateById,
    providedLinkedContainerIds,
  );

  return {
    linkedContainerIds,
    linkedContainerStates,
    hasUnavailableLinkedContainers,
    grants,
    referencedPrincipals,
    effectiveRecipients: linkedContainerRecipients,
    cryptoRecipients: linkedContainerCryptoRecipients,
  };
}

async function computeDocumentAccessFingerprint(input: {
  documentId: string;
  grants: GrantRow[];
  linkedContainerIds: string[];
  linkedContainerFingerprints: string[];
  cryptoRecipients: EffectiveDocumentRecipient[];
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
    recipients: input.cryptoRecipients.map(toPrincipalFingerprintRecipient),
  });
}

async function computeDocumentAccessStateHash(input: {
  documentId: string;
  grants: GrantRow[];
  linkedContainerIds: string[];
  linkedContainerStates: Exclude<ResolvedContainerAccessState, null>[];
}) {
  return computeAccessStateHash({
    objectType: DOCUMENT_OBJECT_TYPE,
    documentId: input.documentId,
    grants: input.grants.map((grant) => ({
      subjectType: grant.subjectType,
      subjectId: grant.subjectId,
      accessLevel: grant.accessLevel,
    })),
    linkedContainers: input.linkedContainerIds.map((containerId, index) => {
      const linkedContainerState = input.linkedContainerStates[index];

      if (!linkedContainerState) {
        throw new Error(
          `Invariant violation: linked container state missing for ${containerId}`,
        );
      }

      return {
        containerId,
        accessStateHash: linkedContainerState.accessStateHash,
      };
    }),
  });
}

async function buildDocumentAccessState(input: {
  currentEpochRow: CurrentEpochRow | null;
  documentId: string;
  effectiveRecipients: EffectiveDocumentRecipient[];
  cryptoRecipients: EffectiveDocumentRecipient[];
  grants: GrantRow[];
  hasUnavailableLinkedContainers: boolean;
  linkedContainerIds: string[];
  linkedContainerStates: Exclude<ResolvedContainerAccessState, null>[];
  referencedPrincipals: ReferencedPrincipalStateResponse[];
}): Promise<DocumentAccessState | null> {
  const {
    currentEpochRow,
    documentId,
    effectiveRecipients,
    cryptoRecipients,
    grants,
    hasUnavailableLinkedContainers,
    linkedContainerIds,
    linkedContainerStates,
    referencedPrincipals,
  } = input;

  if (hasUnavailableLinkedContainers) {
    return null;
  }

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
    cryptoRecipients,
  });
  const accessStateHash = await computeDocumentAccessStateHash({
    documentId,
    grants,
    linkedContainerIds,
    linkedContainerStates,
  });

  const currentAccessEpoch = Math.max(
    currentEpochRow?.epoch ?? 1,
    ...linkedContainerStates.map((state) => state.currentAccessEpoch),
  );

  return {
    currentAccessEpoch,
    accessFingerprint,
    accessStateHash,
    referencedPrincipals,
    effectiveRecipients,
    cryptoRecipients,
  };
}

export async function resolveDocumentAccessState(
  documentId: string,
  executor: DocumentAccessExecutor = db,
  options: {
    linkedContainerIds?: string[];
    linkedContainerStateById?: ReadonlyMap<
      string,
      ResolvedContainerAccessState
    >;
  } = {},
): Promise<DocumentAccessState | null> {
  const currentEpochRow = await getCurrentEpoch(documentId, executor);
  const {
    linkedContainerIds,
    linkedContainerStates,
    grants,
    hasUnavailableLinkedContainers,
    referencedPrincipals,
    effectiveRecipients,
    cryptoRecipients,
  } = await resolveDocumentAccessInputs(
    documentId,
    executor,
    options.linkedContainerStateById,
    options.linkedContainerIds,
  );

  return buildDocumentAccessState({
    currentEpochRow,
    documentId,
    effectiveRecipients,
    cryptoRecipients,
    grants,
    hasUnavailableLinkedContainers,
    linkedContainerIds,
    linkedContainerStates,
    referencedPrincipals,
  });
}

export async function resolveDocumentAccessStates(
  documentIds: string[],
  executor: DocumentAccessExecutor = db,
): Promise<Map<string, DocumentAccessState | null>> {
  const uniqueDocumentIds = uniqueSortedStrings(documentIds);
  const linkedContainerIdsByDocumentId =
    await listLinkedContainerIdsByDocumentId(uniqueDocumentIds, executor);
  const linkedContainerStateById = await resolveContainerAccessStates(
    Array.from(linkedContainerIdsByDocumentId.values()).flat(),
    executor,
  );
  const currentEpochByDocumentId = await getCurrentEpochs(
    uniqueDocumentIds,
    executor,
  );
  const resolvedStates = await Promise.all(
    uniqueDocumentIds.map(
      async (documentId): Promise<[string, DocumentAccessState | null]> => {
        const {
          linkedContainerIds,
          linkedContainerStates,
          grants,
          hasUnavailableLinkedContainers,
          referencedPrincipals,
          effectiveRecipients,
          cryptoRecipients,
        } = await resolveDocumentAccessInputs(
          documentId,
          executor,
          linkedContainerStateById,
          linkedContainerIdsByDocumentId.get(documentId),
        );

        return [
          documentId,
          await buildDocumentAccessState({
            currentEpochRow: currentEpochByDocumentId.get(documentId) ?? null,
            documentId,
            effectiveRecipients,
            cryptoRecipients,
            grants,
            hasUnavailableLinkedContainers,
            linkedContainerIds,
            linkedContainerStates,
            referencedPrincipals,
          }),
        ];
      },
    ),
  );

  return new Map(resolvedStates);
}

export function canReadDocumentAccess(
  state: DocumentAccessState,
  userId: string,
): boolean {
  return state.effectiveRecipients.some((recipient) =>
    isUserPrincipalRecipient(recipient, userId),
  );
}

export function canWriteDocumentAccess(
  state: DocumentAccessState,
  userId: string,
): boolean {
  return state.effectiveRecipients.some(
    (recipient) =>
      isUserPrincipalRecipient(recipient, userId) &&
      accessLevelRank(recipient.accessLevel) >= accessLevelRank("write"),
  );
}

export function listRecipientKeyFingerprints(
  state: DocumentAccessState,
): string[] {
  return state.cryptoRecipients.map((recipient) => recipient.keyFingerprint);
}

export function listRecipientEncapsulationPublicKeys(
  state: DocumentAccessState,
): string[] {
  return state.cryptoRecipients.map(
    (recipient) => recipient.encapsulationPublicKey,
  );
}

export async function createDocumentRecipientEnvelopes(
  state: DocumentAccessState,
): Promise<SerializedRecipientEnvelope[] | null> {
  if (state.cryptoRecipients.length === 0) {
    return null;
  }

  const documentKey = crypto.getRandomValues(new Uint8Array(32));
  const wrappedRecipients = await wrapDekForRecipients(
    documentKey,
    state.cryptoRecipients.map((recipient) =>
      base64ToBytes(recipient.encapsulationPublicKey),
    ),
  );

  return wrappedRecipients
    .map((recipient) => ({
      keyFingerprint: recipient.keyFingerprint,
      kemCipherText: bytesToBase64(recipient.kemCipherText),
      wrappedKey: bytesToBase64(recipient.wrappedKey),
    }))
    .sort((left, right) =>
      left.keyFingerprint.localeCompare(right.keyFingerprint),
    );
}

function envelopeFingerprintsMatchRecipients(
  envelopes: ReadonlyArray<SerializedRecipientEnvelope>,
  recipients: ReadonlyArray<EffectiveDocumentRecipient>,
): boolean {
  const sortedEnvelopeFingerprints = envelopes
    .map((envelope) => envelope.keyFingerprint)
    .sort();
  const envelopeFingerprints = uniqueSortedStrings(sortedEnvelopeFingerprints);
  const recipientFingerprints = uniqueSortedStrings(
    recipients.map((recipient) => recipient.keyFingerprint),
  );

  return (
    sortedEnvelopeFingerprints.length === envelopeFingerprints.length &&
    envelopeFingerprints.length === recipientFingerprints.length &&
    envelopeFingerprints.every(
      (fingerprint, index) => fingerprint === recipientFingerprints[index],
    )
  );
}

export function documentRecipientEnvelopesMatchRecipients(
  envelopes: ReadonlyArray<SerializedRecipientEnvelope>,
  state: DocumentAccessState,
): boolean {
  return envelopeFingerprintsMatchRecipients(envelopes, state.cryptoRecipients);
}

function sortDocumentRecipientEnvelopes(
  envelopes: ReadonlyArray<SerializedRecipientEnvelope>,
): SerializedRecipientEnvelope[] {
  return [...envelopes].sort((left, right) =>
    left.keyFingerprint.localeCompare(right.keyFingerprint),
  );
}

function documentRecipientEnvelopeBundlesEqual(
  left: ReadonlyArray<SerializedRecipientEnvelope>,
  right: ReadonlyArray<SerializedRecipientEnvelope>,
): boolean {
  const sortedLeft = sortDocumentRecipientEnvelopes(left);
  const sortedRight = sortDocumentRecipientEnvelopes(right);

  return (
    sortedLeft.length === sortedRight.length &&
    sortedLeft.every((leftEnvelope, index) => {
      const rightEnvelope = sortedRight[index];
      return (
        rightEnvelope !== undefined &&
        leftEnvelope.keyFingerprint === rightEnvelope.keyFingerprint &&
        leftEnvelope.kemCipherText === rightEnvelope.kemCipherText &&
        leftEnvelope.wrappedKey === rightEnvelope.wrappedKey
      );
    })
  );
}

function recipientIdentityKey(input: {
  principalId: string;
  principalType: string;
  keyFingerprint: string;
}): string {
  return `${input.principalType}:${input.principalId}:${input.keyFingerprint}`;
}

async function listLatestDocumentRecipientEnvelopeIdentities(
  documentId: string,
  executor: DocumentAccessExecutor = db,
): Promise<StoredDocumentRecipientEnvelopeIdentity[] | null> {
  const rows = await executor
    .select({
      epoch: objectRecipientEnvelopes.epoch,
      principalId: objectRecipientEnvelopes.recipientPrincipalId,
      principalType: objectRecipientEnvelopes.recipientPrincipalType,
      keyFingerprint: objectRecipientEnvelopes.recipientKeyFingerprint,
    })
    .from(objectRecipientEnvelopes)
    .where(
      and(
        eq(objectRecipientEnvelopes.objectType, DOCUMENT_OBJECT_TYPE),
        eq(objectRecipientEnvelopes.objectId, documentId),
      ),
    )
    .orderBy(desc(objectRecipientEnvelopes.epoch));

  if (rows.length === 0) {
    return null;
  }

  const latestEpoch = rows[0]?.epoch;
  if (!latestEpoch) {
    return null;
  }

  return rows.filter((row) => row.epoch === latestEpoch);
}

function canReuseDocumentRecipientEnvelopes(
  previousRecipients: ReadonlyArray<StoredDocumentRecipientEnvelopeIdentity>,
  currentRecipients: ReadonlyArray<EffectiveDocumentRecipient>,
): boolean {
  if (previousRecipients.length === 0 || currentRecipients.length === 0) {
    return false;
  }

  const currentRecipientKeys = new Set(
    currentRecipients.map((recipient) =>
      recipientIdentityKey({
        principalId: recipient.principalId,
        principalType: recipient.principalType,
        keyFingerprint: recipient.keyFingerprint,
      }),
    ),
  );

  return previousRecipients.every((recipient) =>
    currentRecipientKeys.has(
      recipientIdentityKey({
        principalId: recipient.principalId,
        principalType: recipient.principalType,
        keyFingerprint: recipient.keyFingerprint,
      }),
    ),
  );
}

export async function getDocumentRecipientEnvelopeAction(
  documentId: string,
  state: DocumentAccessState,
  executor: DocumentAccessExecutor = db,
): Promise<DocumentRecipientEnvelopeAction> {
  const latestRecipients = await listLatestDocumentRecipientEnvelopeIdentities(
    documentId,
    executor,
  );

  if (!latestRecipients) {
    return state.cryptoRecipients.length === 0 ? "none" : "rotate";
  }

  if (latestRecipients[0]?.epoch === state.currentAccessEpoch) {
    return "none";
  }

  return canReuseDocumentRecipientEnvelopes(
    latestRecipients,
    state.cryptoRecipients,
  )
    ? "rewrap"
    : "rotate";
}

export async function listDocumentRecipientEnvelopes(
  documentId: string,
  epoch: number,
  executor: DocumentAccessExecutor = db,
): Promise<SerializedRecipientEnvelope[] | null> {
  const rows = await executor
    .select({
      keyFingerprint: objectRecipientEnvelopes.recipientKeyFingerprint,
      kemCipherText: objectRecipientEnvelopes.kemCipherText,
      wrappedKey: objectRecipientEnvelopes.wrappedKey,
    })
    .from(objectRecipientEnvelopes)
    .where(
      and(
        eq(objectRecipientEnvelopes.objectType, DOCUMENT_OBJECT_TYPE),
        eq(objectRecipientEnvelopes.objectId, documentId),
        eq(objectRecipientEnvelopes.epoch, epoch),
      ),
    );

  if (rows.length === 0) {
    return null;
  }

  return rows
    .sort((left, right) =>
      left.keyFingerprint.localeCompare(right.keyFingerprint),
    )
    .map((row) => ({
      keyFingerprint: row.keyFingerprint,
      kemCipherText: row.kemCipherText,
      wrappedKey: row.wrappedKey,
    }));
}

export async function replaceDocumentRecipientEnvelopes(
  documentId: string,
  epoch: number,
  state: DocumentAccessState,
  envelopes: ReadonlyArray<SerializedRecipientEnvelope>,
  executor: DocumentAccessExecutor = db,
): Promise<void> {
  await putDocumentRecipientEnvelopes(
    documentId,
    epoch,
    state,
    envelopes,
    executor,
  );
}

function buildDocumentRecipientEnvelopeRows(
  documentId: string,
  epoch: number,
  state: DocumentAccessState,
  envelopes: ReadonlyArray<SerializedRecipientEnvelope>,
): Array<typeof objectRecipientEnvelopes.$inferInsert> {
  const recipientByKeyFingerprint = new Map(
    state.cryptoRecipients.map((recipient) => [
      recipient.keyFingerprint,
      recipient,
    ]),
  );

  return envelopes.map((envelope) => {
    if (
      envelope.kemCipherText.length === 0 ||
      envelope.wrappedKey.length === 0
    ) {
      throw new Error(
        `Document recipient envelope is missing wrapped material for ${envelope.keyFingerprint}`,
      );
    }

    const recipient = recipientByKeyFingerprint.get(envelope.keyFingerprint);
    if (!recipient) {
      throw new Error(
        `Invariant violation: recipient not found for key fingerprint ${envelope.keyFingerprint}`,
      );
    }

    const principalRecipient = toPrincipalEnvelopeRecipient(recipient);

    return {
      objectType: DOCUMENT_OBJECT_TYPE,
      objectId: documentId,
      epoch,
      recipientPrincipalType: principalRecipient.principalType,
      recipientPrincipalId: principalRecipient.principalId,
      recipientKeyFingerprint: envelope.keyFingerprint,
      kemCipherText: envelope.kemCipherText,
      wrappedKey: envelope.wrappedKey,
    };
  });
}

export async function putDocumentRecipientEnvelopes(
  documentId: string,
  epoch: number,
  state: DocumentAccessState,
  envelopes: ReadonlyArray<SerializedRecipientEnvelope>,
  executor: DocumentAccessExecutor = db,
): Promise<SerializedRecipientEnvelope[]> {
  if (!documentRecipientEnvelopesMatchRecipients(envelopes, state)) {
    throw new Error("Document recipient envelopes mismatch");
  }

  const sortedEnvelopes = sortDocumentRecipientEnvelopes(envelopes);
  const existingEnvelopes = await listDocumentRecipientEnvelopes(
    documentId,
    epoch,
    executor,
  );

  if (existingEnvelopes && existingEnvelopes.length > 0) {
    if (
      !documentRecipientEnvelopeBundlesEqual(existingEnvelopes, sortedEnvelopes)
    ) {
      throw new DocumentRecipientEnvelopeConflictError();
    }

    return existingEnvelopes;
  }

  if (sortedEnvelopes.length === 0) {
    return [];
  }

  await executor
    .insert(objectRecipientEnvelopes)
    .values(
      buildDocumentRecipientEnvelopeRows(
        documentId,
        epoch,
        state,
        sortedEnvelopes,
      ),
    )
    .onConflictDoNothing({
      target: [
        objectRecipientEnvelopes.objectType,
        objectRecipientEnvelopes.objectId,
        objectRecipientEnvelopes.epoch,
        objectRecipientEnvelopes.recipientKeyFingerprint,
      ],
    });

  const storedEnvelopes = await listDocumentRecipientEnvelopes(
    documentId,
    epoch,
    executor,
  );
  if (!storedEnvelopes || storedEnvelopes.length === 0) {
    throw new Error("Failed to store document recipient envelopes");
  }

  if (
    !documentRecipientEnvelopeBundlesEqual(storedEnvelopes, sortedEnvelopes)
  ) {
    throw new DocumentRecipientEnvelopeConflictError();
  }

  return storedEnvelopes;
}

async function writeEpoch(
  documentId: string,
  epoch: number,
  accessFingerprint: string,
  accessStateHash: string,
  executor: DocumentAccessExecutor = db,
) {
  await executor.insert(objectAccessEpochs).values({
    objectType: DOCUMENT_OBJECT_TYPE,
    objectId: documentId,
    epoch,
    accessFingerprint,
    accessStateHash,
    updatedAt: new Date(),
  });
}

async function materializeDocumentAccessState(
  documentId: string,
  executor: DocumentAccessExecutor = db,
  linkedContainerStateById?: ReadonlyMap<string, ResolvedContainerAccessState>,
  providedLinkedContainerIds?: string[],
  currentEpochRow?: CurrentEpochRow | null,
): Promise<number | null> {
  const resolvedCurrentEpochRow =
    currentEpochRow ?? (await getCurrentEpoch(documentId, executor));
  const {
    linkedContainerIds,
    linkedContainerStates,
    grants,
    hasUnavailableLinkedContainers,
    cryptoRecipients,
  } = await resolveDocumentAccessInputs(
    documentId,
    executor,
    linkedContainerStateById,
    providedLinkedContainerIds,
  );

  if (hasUnavailableLinkedContainers) {
    return null;
  }

  if (resolvedCurrentEpochRow === null && linkedContainerStates.length === 0) {
    return null;
  }

  const accessFingerprint = await computeDocumentAccessFingerprint({
    documentId,
    grants,
    linkedContainerIds,
    linkedContainerFingerprints: linkedContainerStates.map(
      (state) => state.accessFingerprint,
    ),
    cryptoRecipients,
  });
  const accessStateHash = await computeDocumentAccessStateHash({
    documentId,
    grants,
    linkedContainerIds,
    linkedContainerStates,
  });
  const linkedEpoch = Math.max(
    1,
    ...linkedContainerStates.map((state) => state.currentAccessEpoch),
  );
  const nextEpoch =
    resolvedCurrentEpochRow === null
      ? linkedEpoch
      : resolvedCurrentEpochRow.accessFingerprint === accessFingerprint &&
          resolvedCurrentEpochRow.accessStateHash === accessStateHash
        ? Math.max(resolvedCurrentEpochRow.epoch, linkedEpoch)
        : Math.max(resolvedCurrentEpochRow.epoch + 1, linkedEpoch);

  if (
    resolvedCurrentEpochRow === null ||
    resolvedCurrentEpochRow.epoch !== nextEpoch ||
    resolvedCurrentEpochRow.accessFingerprint !== accessFingerprint ||
    resolvedCurrentEpochRow.accessStateHash !== accessStateHash
  ) {
    await writeEpoch(
      documentId,
      nextEpoch,
      accessFingerprint,
      accessStateHash,
      executor,
    );
  }

  return nextEpoch;
}

export async function initializeDocumentAccess(
  documentId: string,
  executor: DocumentAccessExecutor = db,
): Promise<number> {
  const initialize = async (tx: DocumentAccessExecutor) => {
    const {
      linkedContainerIds,
      linkedContainerStates,
      grants,
      hasUnavailableLinkedContainers,
      cryptoRecipients,
    } = await resolveDocumentAccessInputs(documentId, tx);

    if (hasUnavailableLinkedContainers) {
      throw new Error(
        `Document ${documentId} access state could not be initialized`,
      );
    }

    const accessFingerprint = await computeDocumentAccessFingerprint({
      documentId,
      grants,
      linkedContainerIds,
      linkedContainerFingerprints: linkedContainerStates.map(
        (state) => state.accessFingerprint,
      ),
      cryptoRecipients,
    });
    const accessStateHash = await computeDocumentAccessStateHash({
      documentId,
      grants,
      linkedContainerIds,
      linkedContainerStates,
    });
    const initialEpoch = Math.max(
      1,
      ...linkedContainerStates.map((state) => state.currentAccessEpoch),
    );

    await writeEpoch(
      documentId,
      initialEpoch,
      accessFingerprint,
      accessStateHash,
      tx,
    );

    return initialEpoch;
  };

  if (executor === db) {
    return db.transaction(initialize);
  }

  return initialize(executor);
}

export async function refreshDocumentAccesses(
  documentIds: string[],
  executor: DocumentAccessExecutor = db,
): Promise<Map<string, number | null>> {
  const uniqueDocumentIds = uniqueSortedStrings(documentIds);
  const linkedContainerIdsByDocumentId =
    await listLinkedContainerIdsByDocumentId(uniqueDocumentIds, executor);
  const linkedContainerStateById = await resolveContainerAccessStates(
    Array.from(linkedContainerIdsByDocumentId.values()).flat(),
    executor,
  );
  const currentEpochByDocumentId = await getCurrentEpochs(
    uniqueDocumentIds,
    executor,
  );
  const refreshedEpochEntries = await Promise.all(
    uniqueDocumentIds.map(
      async (documentId): Promise<[string, number | null]> => [
        documentId,
        await materializeDocumentAccessState(
          documentId,
          executor,
          linkedContainerStateById,
          linkedContainerIdsByDocumentId.get(documentId),
          currentEpochByDocumentId.get(documentId) ?? null,
        ),
      ],
    ),
  );

  return new Map(refreshedEpochEntries);
}
