import { computeDocumentContentRecordPlaintextHash } from "@tearleads/crypto";

export async function assertDocumentUpdatePlaintextHash(
  updateData: Uint8Array,
  expectedPlaintextHash: string,
): Promise<void> {
  const plaintextHash =
    await computeDocumentContentRecordPlaintextHash(updateData);
  if (plaintextHash !== expectedPlaintextHash) {
    throw new Error("Document update plaintext hash mismatch");
  }
}
