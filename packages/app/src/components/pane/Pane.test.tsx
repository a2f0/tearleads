import { afterEach, expect, spyOn, test } from "bun:test";
import { ApiClient } from "@tearleads/api-client";
import { createModuleDatabaseRuntime } from "@tearleads/sqlite-worker/runtime";
import { isPublicKeyResponse } from "@tearleads/validators/response";
import {
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import invariant from "invariant";
import { MockWorker } from "../../../test/helpers/mockWorker";
import { resetMockServer, wsUrl } from "../../../test/helpers/mswServer";
import { AppHostConfig } from "../../host/AppHostConfig";
import { DualPaneProvider, PaneSideProvider } from "./DualPaneProvider";
import { Pane } from "./Pane";
import { PaneProvider } from "./PaneProvider";

afterEach(async () => {
  cleanup();
  await resetMockServer();
});

function renderPane() {
  return render(
    <DualPaneProvider>
      <PaneSideProvider side="left">
        <PaneProvider
          hostConfig={
            new AppHostConfig("http://localhost:3001", wsUrl, () =>
              createModuleDatabaseRuntime({ workerConstructor: MockWorker }),
            )
          }
        >
          <Pane className="pane" />
        </PaneProvider>
      </PaneSideProvider>
    </DualPaneProvider>,
  );
}

async function openExplorer(view: ReturnType<typeof renderPane>) {
  fireEvent.contextMenu(view.getByRole("application"), {
    clientX: 120,
    clientY: 120,
  });
  fireEvent.click(view.getByText("Open Explorer"));

  let explorerWindow: HTMLDivElement | null = null;
  await waitFor(() => {
    const windows =
      view.container.querySelectorAll<HTMLDivElement>("div.window");
    explorerWindow = windows[windows.length - 1] ?? null;
    expect(explorerWindow).toBeTruthy();
  });

  invariant(explorerWindow, "explorer window not found");
  const readyExplorerWindow = explorerWindow;

  await waitFor(() => {
    expect(
      within(readyExplorerWindow).getByRole("button", { name: "New Note" }),
    ).toBeTruthy();
  });

  return readyExplorerWindow;
}

function listExplorerNoteItems(
  explorerWindow: HTMLElement,
): HTMLButtonElement[] {
  return Array.from(
    explorerWindow.querySelectorAll<HTMLButtonElement>(
      "button.explorer-sidebar-item--note",
    ),
  );
}

async function generatePersonaAndWaitForDb(
  view: ReturnType<typeof renderPane>,
) {
  fireEvent.click(view.getByText("Menu"));
  fireEvent.click(view.getByText("Generate Key Pair"));

  await waitFor(() => {
    expect(view.getByText(/sqlite worker: ready/)).toBeTruthy();
    expect(view.queryByText(/publicKey: none/)).toBeNull();
  });
}

test("displays userId after uploading public key", async () => {
  const spy = spyOn(ApiClient.prototype, "postPublicKey");
  const view = renderPane();

  expect(view.getByText(/userId: none/)).toBeTruthy();

  await generatePersonaAndWaitForDb(view);

  fireEvent.click(view.getByText("Menu"));
  await waitFor(() => {
    expect(view.getByText("Upload Public Key")).toBeTruthy();
  });
  fireEvent.click(view.getByText("Upload Public Key"));

  await waitFor(() => {
    expect(spy.mock.results).toHaveLength(1);
  });
  const spyResult = spy.mock.results[0];
  invariant(spyResult, "spy has no results");
  const result = await spyResult.value;
  if (!isPublicKeyResponse(result)) throw new Error("invalid response");
  const { userId } = result;

  await waitFor(() => {
    expect(view.getByText(new RegExp(`userId: ${userId}`))).toBeTruthy();
  });

  fireEvent.click(view.getByText("Menu"));
  expect(view.queryByText("Upload Public Key")).toBeNull();

  spy.mockRestore();
  view.unmount();
});

test("userId resets to none when key pair is destroyed", async () => {
  const spy = spyOn(ApiClient.prototype, "postPublicKey");
  const view = renderPane();

  await generatePersonaAndWaitForDb(view);

  fireEvent.click(view.getByText("Menu"));
  await waitFor(() => {
    expect(view.getByText("Upload Public Key")).toBeTruthy();
  });
  fireEvent.click(view.getByText("Upload Public Key"));

  await waitFor(() => {
    expect(spy.mock.results).toHaveLength(1);
  });
  const spyResult = spy.mock.results[0];
  invariant(spyResult, "spy has no results");
  const result = await spyResult.value;
  if (!isPublicKeyResponse(result)) throw new Error("invalid response");
  const { userId } = result;

  await waitFor(() => {
    expect(view.getByText(new RegExp(`userId: ${userId}`))).toBeTruthy();
  });

  fireEvent.click(view.getByText("Menu"));
  fireEvent.click(view.getByText("Destroy Key Pair"));

  await waitFor(() => {
    expect(view.getByText(/userId: none/)).toBeTruthy();
  });

  spy.mockRestore();
  view.unmount();
});

test("notes windows in the same pane share live note state", async () => {
  const view = renderPane();

  await generatePersonaAndWaitForDb(view);

  fireEvent.contextMenu(view.getByRole("application"), {
    clientX: 120,
    clientY: 120,
  });
  fireEvent.click(view.getByText("Open Notes"));
  fireEvent.contextMenu(view.getByRole("application"), {
    clientX: 160,
    clientY: 160,
  });
  fireEvent.click(view.getByText("Open Notes"));

  await waitFor(() => {
    const editors = Array.from(
      view.container.querySelectorAll<HTMLTextAreaElement>(
        "textarea.notes-editor",
      ),
    );
    expect(editors).toHaveLength(2);
    for (const editor of editors) {
      expect(editor.disabled).toBe(false);
    }
  });

  const noteEditors = view.container.querySelectorAll<HTMLTextAreaElement>(
    "textarea.notes-editor",
  );
  const firstEditor = noteEditors[0];
  const secondEditor = noteEditors[1];

  invariant(firstEditor, "first editor not found");
  invariant(secondEditor, "second editor not found");

  fireEvent.change(firstEditor, {
    target: { value: "shared pane note" },
  });

  await waitFor(() => {
    expect(firstEditor.value).toBe("shared pane note");
    expect(secondEditor.value).toBe("shared pane note");
  });

  view.unmount();
});

test("contacts windows in the same pane share live address book state", async () => {
  const spy = spyOn(ApiClient.prototype, "postPublicKey");
  const view = renderPane();

  await generatePersonaAndWaitForDb(view);

  fireEvent.click(view.getByText("Menu"));
  await waitFor(() => {
    expect(view.getByText("Upload Public Key")).toBeTruthy();
  });
  fireEvent.click(view.getByText("Upload Public Key"));

  await waitFor(() => {
    expect(spy.mock.results).toHaveLength(1);
  });
  const spyResult = spy.mock.results[0];
  invariant(spyResult, "spy has no results");
  await spyResult.value;
  spy.mockRestore();

  await waitFor(() => {
    expect(view.queryByText(/userId: none/)).toBeNull();
  });

  fireEvent.contextMenu(view.getByRole("application"), {
    clientX: 120,
    clientY: 120,
  });
  fireEvent.click(view.getByText("Open Contacts"));
  fireEvent.contextMenu(view.getByRole("application"), {
    clientX: 160,
    clientY: 160,
  });
  fireEvent.click(view.getByText("Open Contacts"));

  await waitFor(() => {
    const contactsApps = Array.from(
      view.container.querySelectorAll<HTMLDivElement>(".contacts"),
    );
    expect(contactsApps).toHaveLength(2);
  });

  const contactsApps =
    view.container.querySelectorAll<HTMLDivElement>(".contacts");
  const firstContactsApp = contactsApps[0];

  invariant(firstContactsApp, "first contacts app not found");

  const firstInput = within(firstContactsApp).getByLabelText("Contact user ID");
  invariant(firstInput, "contact input not found");

  fireEvent.change(firstInput, {
    target: { value: "peer-user-1" },
  });

  const updatedFirstContactsApp = view
    .getByDisplayValue("peer-user-1")
    .closest(".contacts");

  await waitFor(() => {
    invariant(
      updatedFirstContactsApp instanceof HTMLDivElement,
      "updated first contacts app not found",
    );
    const importButton = within(updatedFirstContactsApp).getByRole("button", {
      name: "Import",
    });
    invariant(
      importButton instanceof HTMLButtonElement,
      "contact import button not found",
    );
    expect(importButton.disabled).toBe(false);
  });

  invariant(
    updatedFirstContactsApp instanceof HTMLDivElement,
    "updated first contacts app not found",
  );

  const firstImportButton = within(updatedFirstContactsApp).getByRole(
    "button",
    {
      name: "Import",
    },
  );
  invariant(
    firstImportButton instanceof HTMLButtonElement,
    "contact import button not found",
  );

  fireEvent.click(firstImportButton);

  await waitFor(() => {
    expect(view.getAllByText("peer")).toHaveLength(2);
  });

  view.unmount();
});

test("explorer windows in the same pane share newly created notes without refresh", async () => {
  const view = renderPane();

  await generatePersonaAndWaitForDb(view);

  const firstExplorer = await openExplorer(view);
  const secondExplorer = await openExplorer(view);

  await waitFor(() => {
    expect(listExplorerNoteItems(secondExplorer)).toHaveLength(0);
  });

  fireEvent.click(
    within(firstExplorer).getByRole("button", { name: "New Note" }),
  );

  await waitFor(() => {
    expect(
      within(firstExplorer).getByRole("button", { name: "Back to Container" }),
    ).toBeTruthy();
  });

  const editor = await within(firstExplorer).findByRole("textbox", {
    name: /Notes editor/,
  });
  invariant(editor instanceof HTMLTextAreaElement, "note editor not found");

  fireEvent.change(editor, {
    target: { value: "fresh explorer note" },
  });

  await waitFor(() => {
    expect(editor.value).toBe("fresh explorer note");
    expect(
      listExplorerNoteItems(firstExplorer).some(
        (button) => button.textContent?.trim() === "fresh explorer note",
      ),
    ).toBe(true);
  });

  await waitFor(() => {
    expect(
      listExplorerNoteItems(secondExplorer).some(
        (button) => button.textContent?.trim() === "fresh explorer note",
      ),
    ).toBe(true);
  });

  view.unmount();
});
