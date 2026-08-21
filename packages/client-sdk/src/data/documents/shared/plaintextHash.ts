import { computeDocumentContentRecordPlaintextHash } from "@symcrypt/crypto";

export async function assertDocumentUpdatePlaintextHash(
  updateData: Uint8Array,
  expectedPlaintextHash: string,
  plaintextHashKey: CryptoKey,
): Promise<void> {
  const plaintextHash = await computeDocumentContentRecordPlaintextHash(
    updateData,
    plaintextHashKey,
  );
  if (plaintextHash !== expectedPlaintextHash) {
    throw new Error("Document update plaintext hash mismatch");
  }
}
