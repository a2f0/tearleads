type RecipientPrincipalType = "user" | "group" | "organization";

type AccessLevel = "read" | "write" | "admin";

interface UserRecipientKeyIdentity {
  userId: string;
  keyFingerprint: string;
}

interface UserRecipientFingerprintInput extends UserRecipientKeyIdentity {
  accessLevel: AccessLevel;
}

interface PrincipalEnvelopeRecipient {
  principalType: RecipientPrincipalType;
  principalId: string;
  keyFingerprint: string;
}

interface PrincipalFingerprintRecipient extends PrincipalEnvelopeRecipient {
  accessLevel: AccessLevel;
}

export function toUserPrincipalEnvelopeRecipient(
  recipient: UserRecipientKeyIdentity,
): PrincipalEnvelopeRecipient {
  return {
    principalType: "user",
    principalId: recipient.userId,
    keyFingerprint: recipient.keyFingerprint,
  };
}

export function toUserPrincipalFingerprintRecipient(
  recipient: UserRecipientFingerprintInput,
): PrincipalFingerprintRecipient {
  return {
    principalType: "user",
    principalId: recipient.userId,
    accessLevel: recipient.accessLevel,
    keyFingerprint: recipient.keyFingerprint,
  };
}
