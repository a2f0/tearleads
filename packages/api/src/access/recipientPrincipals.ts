export type RecipientPrincipalType = "user" | "group" | "organization";

export type AccessLevel = "read" | "write" | "admin";

interface UserRecipientFingerprintInput {
  userId: string;
  accessLevel: AccessLevel;
  keyFingerprint: string;
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

export function isAccessLevel(value: string): value is AccessLevel {
  return value === "read" || value === "write" || value === "admin";
}

export function accessLevelRank(accessLevel: AccessLevel): number {
  if (accessLevel === "admin") {
    return 3;
  }

  if (accessLevel === "write") {
    return 2;
  }

  return 1;
}

export function mergeAccessLevel(
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

export function isUserPrincipalRecipient(
  recipient: Pick<PrincipalEnvelopeRecipient, "principalType" | "principalId">,
  userId: string,
): boolean {
  return recipient.principalType === "user" && recipient.principalId === userId;
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
