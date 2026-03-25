export type EncryptedEnvelope = {
  iv: Uint8Array;
  ciphertext: Uint8Array;
  recipients: RecipientEntry[];
};

export type RecipientEntry = {
  kemCipherText: Uint8Array;
  wrappedKey: Uint8Array;
};
