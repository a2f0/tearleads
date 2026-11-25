import { createHmac } from "node:crypto";
import { deriveStableDocumentId } from "@tearleads/client-sdk";
import { PASSCODE_DOCUMENT_KIND } from "app/passcode";
import type { CliSession } from "../session";
import { passcodeFromEntry } from "./passcodeFromEntry";
import type { RestoredGroup } from "./restoreFolders";

/**
 * One document id per entry of this restore: keyed by the restore folder, so
 * two restores never collide, and by the entry's position, so a database that
 * repeats a UUID still gets distinct documents.
 */
async function passcodeDocumentId(
  signingPrivateKey: Uint8Array,
  restoreFolderId: string,
  ordinal: number,
  entryId: string,
): Promise<string> {
  const localId = createHmac("sha256", signingPrivateKey)
    .update(`tearleads.keepass/${restoreFolderId}/${ordinal}/${entryId}`)
    .digest("hex");
  return deriveStableDocumentId(localId);
}

/**
 * Creates one passcode per entry, each in its group's folder, as a single
 * online create the API acknowledges. Returns how many it created.
 */
export async function createRestoredPasscodes(
  session: CliSession,
  input: {
    readonly groups: readonly RestoredGroup[];
    readonly signingPrivateKey: Uint8Array;
  },
): Promise<number> {
  const { sdk, tracer } = session;
  const restoreFolderId = input.groups[0]?.folderId;
  if (!restoreFolderId) throw new Error("The restore has no folder.");
  const total = input.groups.reduce(
    (sum, { group }) => sum + group.entries.length,
    0,
  );
  let created = 0;
  for (const { folderId, group } of input.groups) {
    for (const entry of group.entries) {
      const ordinal = created + 1;
      // Traces name the position only: titles and URLs are the user's data.
      await tracer.span(`create passcode ${ordinal} of ${total}`, async () => {
        const content = passcodeFromEntry(entry);
        const receipt = await sdk.documents.createSeeded({
          containerId: folderId,
          documentId: await passcodeDocumentId(
            input.signingPrivateKey,
            restoreFolderId,
            ordinal,
            entry.id,
          ),
          initialDocumentKind: PASSCODE_DOCUMENT_KIND,
          initialRows: content.rows,
          initialStructuredFields: content.fields,
          onRecoveredStaleTarget: () =>
            session.recordExpectedSeedFailure("recovered stale target"),
        });
        if (receipt === "purged") {
          throw new Error(`Passcode ${ordinal} was refused as deleted.`);
        }
      });
      created = ordinal;
    }
  }
  session.assertNoFailures();
  return created;
}
