import type { ReferencedPrincipalStateResponse } from "@tearleads/validators/response";
import { and, desc, eq, inArray } from "drizzle-orm";
import { type DatabaseExecutor, db } from "../adapters/postgres";
import { documentContainerLinks, objectAccessEpochs } from "../schema";
import { uniqueSortedStrings } from "../utils/array";
import {
  computeAccessFingerprint,
  computeAccessStateHash,
} from "./accessFingerprint";
import { resolveContainerAccessState } from "./containerAccess";
import { mergeReferencedPrincipals } from "./principalReferences";
import {
  type EffectivePrincipalRecipient,
  isUserPrincipalRecipient,
  mergeAccessLevel,
  principalRecipientKey,
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

interface DocumentAccessState {
  currentAccessEpoch: number;
  accessFingerprint: string;
  accessStateHash: string;
  referencedPrincipals: ReferencedPrincipalStateResponse[];
  effectiveRecipients: EffectiveDocumentRecipient[];
  cryptoRecipients: EffectiveDocumentRecipient[];
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
