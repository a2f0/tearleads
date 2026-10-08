import { bytesToBase64 } from "@tearleads/encoding";
import type { PrincipalMutationJournalRow } from "../persistence/principalMutationJournalPersistence";

/** Identifies exact local bytes for an acknowledged discard, never for replay. */
export async function principalMutationJournalRecordId(
  row: PrincipalMutationJournalRow,
): Promise<string> {
  const bytes = new TextEncoder().encode(
    JSON.stringify([
      "tearleads.sdk.unreadable-principal-mutation.v1",
      row.scopeId,
      row.organizationId,
      row.serializedRequest,
      row.signature,
    ]),
  );
  return bytesToBase64(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  );
}

export class UnreadablePrincipalMutationError extends Error {
  constructor(
    readonly recordId: string,
    readonly reason: "authentication" | "format",
  ) {
    super(
      reason === "authentication"
        ? "Saved principal mutation could not be authenticated"
        : "Saved principal mutation has an unsupported or invalid format",
    );
    this.name = "UnreadablePrincipalMutationError";
  }
}
