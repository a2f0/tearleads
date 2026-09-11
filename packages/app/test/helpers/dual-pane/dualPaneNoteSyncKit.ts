import { expect } from "bun:test";
import { isBlobAttachmentBindResponse } from "@tearleads/validators/response";
import { fireEvent, waitFor, within } from "@testing-library/react";
import invariant from "invariant";
import { listProxiedApiRequests } from "../mswServer";
import type { ProxiedApiRequest } from "../proxiedApiResponse";
import {
  DUAL_PANE_TEST_TIMEOUT_MS,
  getExplorerWindowRoot,
  interact,
} from "./dualPaneCore";
import {
  createNoteWithAttachment,
  openExplorer,
  selectExplorerNoteByName,
} from "./dualPaneExplorerKit";
import { openMiniApp, typeMiniAppNote } from "./dualPaneMiniAppKit";
import { waitForRemoteAttachmentBlob } from "./dualPaneSyncKit";

export type NoteEntryPoint = "Notes" | "Explorer";

export async function createAttachedMiniAppNote(
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
    { timeout: DUAL_PANE_TEST_TIMEOUT_MS },
  );
  await interact(() => fireEvent.click(note));
}

function parseResponseBody(request: ProxiedApiRequest): unknown {
  try {
    return JSON.parse(request.responseBody);
  } catch (cause) {
    throw new Error(`Expected JSON from ${request.method} ${request.url}`, {
      cause,
    });
  }
}

export function getAttachedNoteDocumentId(): string {
  const request = listProxiedApiRequests().find(
    (request) =>
      request.method === "POST" &&
      request.status === 200 &&
      request.url.endsWith("/attachment-bindings"),
  );
  invariant(request, "Expected the note's successful attachment binding.");
  const response = parseResponseBody(request);
  invariant(
    isBlobAttachmentBindResponse(response),
    "Expected a document ID in the attachment binding.",
  );
  return response.documentId;
}

export function documentSyncBatchSizes(requestStartIndex: number): number[] {
  return listProxiedApiRequests()
    .slice(requestStartIndex)
    .filter(
      (request) => request.url.endsWith("/sync") && request.status === 200,
    )
    .flatMap((request) => {
      const response = parseResponseBody(request);
      const updates =
        response && typeof response === "object"
          ? Reflect.get(response, "updates")
          : undefined;
      return Array.isArray(updates) ? [updates.length] : [];
    });
}
