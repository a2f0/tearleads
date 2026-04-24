import type { ReferencedPrincipalStateResponse } from "@tearleads/validators/response";
import type { DatabaseExecutor } from "../adapters/postgres";
import type {
  AccessGrantRow as ContainerGrantRow,
  GrantedRecipientWithObjectIdRow,
} from "./principalGrantResolver";
import { mergeReferencedPrincipals } from "./principalReferences";
import {
  type EffectivePrincipalRecipient,
  isAccessLevel,
  mergeAccessLevel,
  principalRecipientKey,
  toEffectiveUserPrincipalRecipient,
} from "./recipientPrincipals";

export const CONTAINER_OBJECT_TYPE = "container";

export type SubjectType = "user" | "group" | "organization";
export type ContainerAccessExecutor = DatabaseExecutor;
export type EffectiveContainerRecipient = EffectivePrincipalRecipient;

interface GrantedRecipientRow {
  userId: string;
  accessLevel: string;
  encapsulationPublicKey: string;
  encapsulationKeyFingerprint: string;
}

interface AncestorContainerRow {
  id: string;
  cycleDetected: boolean;
}

export interface DescendantContainerRow {
  id: string;
  parentId: string | null;
  depth: number;
}

export type CurrentEpochRow = {
  epoch: number;
  accessFingerprint: string;
  accessStateHash: string | null;
};

export interface ContainerAccessState {
  currentAccessEpoch: number;
  accessFingerprint: string;
  accessStateHash: string;
  ancestorContainerIds: string[];
  grants: Array<{
    objectId: string;
    subjectType: string;
    subjectId: string;
    accessLevel: string;
  }>;
  referencedPrincipals: ReferencedPrincipalStateResponse[];
  effectiveRecipients: EffectiveContainerRecipient[];
  cryptoRecipients: EffectiveContainerRecipient[];
}

export interface DirectResolvedGrantInputs {
  effectiveRecipients: EffectiveContainerRecipient[];
  referencedPrincipals: ReferencedPrincipalStateResponse[];
}

export interface ResolvedContainerInputs {
  ancestorContainerIds: string[];
  effectiveRecipients: EffectiveContainerRecipient[];
  grants: ContainerGrantRow[];
  referencedPrincipals: ReferencedPrincipalStateResponse[];
}

export interface ResolvedContainerRecipients extends ResolvedContainerInputs {
  cryptoRecipients: EffectiveContainerRecipient[];
}

export function mergeReferencedPrincipalStateArrays(
  ...principalSets: ReadonlyArray<ReferencedPrincipalStateResponse>[]
): ReferencedPrincipalStateResponse[] {
  return mergeReferencedPrincipals(
    principalSets.map((referencedPrincipals) => ({
      referencedPrincipals: [...referencedPrincipals],
    })),
  );
}

export function isAncestorContainerRow(
  value: unknown,
): value is AncestorContainerRow {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  return (
    typeof Reflect.get(value, "id") === "string" &&
    typeof Reflect.get(value, "cycleDetected") === "boolean"
  );
}

export function isDescendantContainerRow(
  value: unknown,
): value is DescendantContainerRow {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  return (
    typeof Reflect.get(value, "id") === "string" &&
    (typeof Reflect.get(value, "parentId") === "string" ||
      Reflect.get(value, "parentId") === null) &&
    typeof Reflect.get(value, "depth") === "number"
  );
}

export function buildEffectiveRecipientsFromGrantedRecipients(
  grantedRecipients: ReadonlyArray<GrantedRecipientRow>,
): EffectiveContainerRecipient[] {
  const recipientsByPrincipalKey = new Map<
    string,
    EffectiveContainerRecipient
  >();

  for (const recipient of grantedRecipients) {
    if (
      !isAccessLevel(recipient.accessLevel) ||
      recipient.encapsulationPublicKey.length === 0 ||
      recipient.encapsulationKeyFingerprint.length === 0
    ) {
      continue;
    }

    const nextRecipient = toEffectiveUserPrincipalRecipient({
      userId: recipient.userId,
      accessLevel: recipient.accessLevel,
      encapsulationPublicKey: recipient.encapsulationPublicKey,
      keyFingerprint: recipient.encapsulationKeyFingerprint,
    });
    const principalKey = principalRecipientKey(nextRecipient);
    const existingRecipient = recipientsByPrincipalKey.get(principalKey);

    recipientsByPrincipalKey.set(principalKey, {
      ...nextRecipient,
      accessLevel: existingRecipient
        ? mergeAccessLevel(
            existingRecipient.accessLevel,
            nextRecipient.accessLevel,
          )
        : nextRecipient.accessLevel,
    });
  }

  const effectiveRecipients = Array.from(recipientsByPrincipalKey.values());

  effectiveRecipients.sort((left, right) =>
    left.keyFingerprint.localeCompare(right.keyFingerprint),
  );

  return effectiveRecipients;
}

export function mergeEffectiveRecipients(
  inheritedRecipients: ReadonlyArray<EffectiveContainerRecipient>,
  directRecipients: ReadonlyArray<EffectiveContainerRecipient>,
): EffectiveContainerRecipient[] {
  const recipientsByPrincipalKey = new Map<
    string,
    EffectiveContainerRecipient
  >();

  for (const recipient of inheritedRecipients) {
    recipientsByPrincipalKey.set(principalRecipientKey(recipient), recipient);
  }

  for (const recipient of directRecipients) {
    const principalKey = principalRecipientKey(recipient);
    const existingRecipient = recipientsByPrincipalKey.get(principalKey);

    recipientsByPrincipalKey.set(principalKey, {
      principalType: recipient.principalType,
      principalId: recipient.principalId,
      accessLevel: existingRecipient
        ? mergeAccessLevel(existingRecipient.accessLevel, recipient.accessLevel)
        : recipient.accessLevel,
      encapsulationPublicKey: recipient.encapsulationPublicKey,
      keyFingerprint: recipient.keyFingerprint,
    });
  }

  return Array.from(recipientsByPrincipalKey.values()).sort((left, right) =>
    left.keyFingerprint.localeCompare(right.keyFingerprint),
  );
}

export function toGrantedRecipientRowsByObjectId(
  recipients: ReadonlyArray<GrantedRecipientWithObjectIdRow>,
): Map<string, GrantedRecipientRow[]> {
  const grantedRecipientsByObjectId = new Map<string, GrantedRecipientRow[]>();

  for (const recipient of recipients) {
    const nextRecipients =
      grantedRecipientsByObjectId.get(recipient.objectId) ?? [];
    nextRecipients.push({
      userId: recipient.userId,
      accessLevel: recipient.accessLevel,
      encapsulationPublicKey: recipient.encapsulationPublicKey,
      encapsulationKeyFingerprint: recipient.encapsulationKeyFingerprint,
    });
    grantedRecipientsByObjectId.set(recipient.objectId, nextRecipients);
  }

  return grantedRecipientsByObjectId;
}
