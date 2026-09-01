import type { FileSaver, SaveFileRequest } from "@tearleads/client-sdk";
import {
  ELECTROBUN_FILE_NAME_HEADER,
  ELECTROBUN_SAVE_FILE_PATH,
} from "../saveFileBridge";

// Electrobun's renderer is a WKWebView with no browser download destination, so
// the shared app's anchor saver is a silent no-op. Post the bytes to the Bun
// main process over the local app server (the same origin that served this
// renderer), which writes the file to the user's Downloads folder and reveals
// it in the file manager. See packages/app-electrobun/src/bun/index.ts.
export function createElectrobunFileSaver(): FileSaver {
  return {
    async saveFile(request: SaveFileRequest): Promise<void> {
      const response = await fetch(ELECTROBUN_SAVE_FILE_PATH, {
        body: request.data,
        headers: {
          "content-type": request.mimeType || "application/octet-stream",
          [ELECTROBUN_FILE_NAME_HEADER]: encodeURIComponent(request.fileName),
        },
        method: "POST",
      });
      if (!response.ok) {
        throw new Error(
          `Failed to save file (${response.status} ${response.statusText}).`,
        );
      }
    },
  };
}
