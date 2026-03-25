export type EncryptedEnvelope = {
  iv: Uint8Array;
  ciphertext: Uint8Array;
  recipients: RecipientEntry[];
};

export type RecipientEntry = {
  keyFingerprint: string;
  kemCipherText: Uint8Array;
  wrappedKey: Uint8Array;
};
