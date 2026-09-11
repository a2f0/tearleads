import { expect } from "bun:test";
import { fireEvent, waitFor, within } from "@testing-library/react";
import invariant from "invariant";
import { listProxiedApiRequests } from "../mswServer";
import { getExplorerWindowRoot, interact } from "./dualPaneCore";
import {
  createNoteWithAttachment,
  openExplorer,
  selectExplorerNoteByName,
} from "./dualPaneExplorerKit";
import { openMiniApp, typeMiniAppNote } from "./dualPaneMiniAppKit";
import { waitForRemoteAttachmentBlob } from "./dualPaneSyncKit";

export type NoteEntryPoint = "Notes" | "Explorer";

export async function createBackspaceNote(
  pane: HTMLElement,
  app: NoteEntryPoint,
  title: string,
  attachmentName: string,
): Promise<HTMLElement> {
  if (app === "Explorer") {
    await openExplorer(pane);
    await createNoteWithAttachment(pane, { title, attachmentName });
    await selectExplorerNoteByName(pane, title);
    return getExplorerWindowRoot(pane);
  }

  const window = await openMiniApp(pane, "Notes");
  // Write the automatically selected draft without clicking New Note.
  await typeMiniAppNote(window, title);
  const fileInput = window.querySelector<HTMLInputElement>(
    "input.note-document-file-input",
  );
  invariant(fileInput, "Expected Notes attachment input.");
  await waitFor(() => expect(fileInput.disabled).toBe(false));
  await interact(() =>
    fireEvent.change(fileInput, {
      target: {
        files: [
          new File(["attachment contents"], attachmentName, {
            type: "image/png",
          }),
        ],
      },
    }),
  );
  await within(window).findByText(attachmentName);
  await waitForRemoteAttachmentBlob();
  return window;
}

export async function selectMiniAppNote(window: HTMLElement, title: string) {
  const note = await within(window).findByRole(
    "button",
    { name: title },
    { timeout: 20_000 },
  );
  await interact(() => fireEvent.click(note));
}

export function documentSyncBatchSizes(requestStartIndex: number): number[] {
  return listProxiedApiRequests()
    .slice(requestStartIndex)
    .filter(
      (request) => request.url.endsWith("/sync") && request.status === 200,
    )
    .flatMap((request) => {
      const response: unknown = JSON.parse(request.responseBody);
      const updates =
        response && typeof response === "object"
          ? Reflect.get(response, "updates")
          : undefined;
      return Array.isArray(updates) ? [updates.length] : [];
    });
}
