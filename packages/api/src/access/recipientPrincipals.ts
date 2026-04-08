export type RecipientPrincipalType = "user" | "group" | "organization";

export type AccessLevel = "read" | "write" | "admin";

interface UserRecipientKeyIdentity {
  userId: string;
  keyFingerprint: string;
}

interface UserRecipientFingerprintInput extends UserRecipientKeyIdentity {
  accessLevel: AccessLevel;
}

export interface PrincipalEnvelopeRecipient {
  principalType: RecipientPrincipalType;
  principalId: string;
  keyFingerprint: string;
}

export interface PrincipalFingerprintRecipient
  extends PrincipalEnvelopeRecipient {
  accessLevel: AccessLevel;
}

export interface EffectivePrincipalRecipient
  extends PrincipalFingerprintRecipient {
  encapsulationPublicKey: string;
}

interface EffectivePrincipalRecipientInput
  extends PrincipalFingerprintRecipient {
  encapsulationPublicKey: string;
}

export function principalRecipientKey(
  recipient: Pick<PrincipalEnvelopeRecipient, "principalType" | "principalId">,
): string {
  return `${recipient.principalType}:${recipient.principalId}`;
}

export function isUserPrincipalRecipient(
  recipient: Pick<PrincipalEnvelopeRecipient, "principalType" | "principalId">,
  userId: string,
): boolean {
  return recipient.principalType === "user" && recipient.principalId === userId;
}

export function toPrincipalEnvelopeRecipient(
  recipient: Pick<
    PrincipalEnvelopeRecipient,
    "principalType" | "principalId" | "keyFingerprint"
  >,
): PrincipalEnvelopeRecipient {
  return {
    principalType: recipient.principalType,
    principalId: recipient.principalId,
    keyFingerprint: recipient.keyFingerprint,
  };
}

export function toPrincipalFingerprintRecipient(
  recipient: Pick<
    PrincipalFingerprintRecipient,
    "principalType" | "principalId" | "accessLevel" | "keyFingerprint"
  >,
): PrincipalFingerprintRecipient {
  return {
    principalType: recipient.principalType,
    principalId: recipient.principalId,
    accessLevel: recipient.accessLevel,
    keyFingerprint: recipient.keyFingerprint,
  };
}

export function toEffectivePrincipalRecipient(
  recipient: EffectivePrincipalRecipientInput,
): EffectivePrincipalRecipient {
  return {
    ...toPrincipalFingerprintRecipient(recipient),
    encapsulationPublicKey: recipient.encapsulationPublicKey,
  };
}

export function toEffectiveUserPrincipalRecipient(
  recipient: UserRecipientFingerprintInput & {
    encapsulationPublicKey: string;
  },
): EffectivePrincipalRecipient {
  return toEffectivePrincipalRecipient({
    ...toUserPrincipalFingerprintRecipient(recipient),
    encapsulationPublicKey: recipient.encapsulationPublicKey,
  });
}

export function toUserPrincipalEnvelopeRecipient(
  recipient: UserRecipientKeyIdentity,
): PrincipalEnvelopeRecipient {
  return toPrincipalEnvelopeRecipient({
    principalType: "user",
    principalId: recipient.userId,
    keyFingerprint: recipient.keyFingerprint,
  });
}

export function toUserPrincipalFingerprintRecipient(
  recipient: UserRecipientFingerprintInput,
): PrincipalFingerprintRecipient {
  return toPrincipalFingerprintRecipient({
    principalType: "user",
    principalId: recipient.userId,
    accessLevel: recipient.accessLevel,
    keyFingerprint: recipient.keyFingerprint,
  });
}
