import type { DocumentRotationProofMode } from "../../../../workflows/documents";
import { ensureDocumentStoreReady } from "../initialization";
import type { DocumentStoreState } from "../state";
import { assertDocumentStoreCanRotateContentKey } from "./index";

export async function assertLoadedDocumentStoreCanRotate(
  state: DocumentStoreState,
  scheduleSync: () => void,
  proof: DocumentRotationProofMode,
): Promise<Uint8Array> {
  if (!(await ensureDocumentStoreReady(state, scheduleSync)) || !state.doc) {
    throw new Error(
      "Document must finish loading before its content key can rotate",
    );
  }
  return assertDocumentStoreCanRotateContentKey(state, proof);
}
