import { afterEach, expect, spyOn, test } from "bun:test";
import { ApiClient } from "@tearleads/api-client";
import { isPublicKeyResponse } from "@tearleads/validators/response";
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import invariant from "invariant";
import { MockWorker } from "../../../test/helpers/mockWorker";
import { resetMockServer, wsUrl } from "../../../test/helpers/mswServer";
import { createAppDatabaseWorker } from "../../db/sqliteWorker";
import { AppHostConfig } from "../../host/AppHostConfig";
import { DualPaneProvider, PaneSideProvider } from "./DualPaneProvider";
import { Pane } from "./Pane";
import { PaneProvider } from "./PaneProvider";

afterEach(() => resetMockServer());

function renderPane() {
  return render(
    <DualPaneProvider>
      <PaneSideProvider side="left">
        <PaneProvider
          hostConfig={
            new AppHostConfig("http://localhost:3001", wsUrl, () =>
              createAppDatabaseWorker(MockWorker),
            )
          }
        >
          <Pane className="pane" />
        </PaneProvider>
      </PaneSideProvider>
    </DualPaneProvider>,
  );
}

test("displays userId after uploading public key", async () => {
  const spy = spyOn(ApiClient.prototype, "postPublicKey");
  const view = renderPane();

  expect(view.getByText(/userId: none/)).toBeTruthy();

  await waitFor(() => {
    expect(view.getByText(/sqlite worker: ready/)).toBeTruthy();
  });

  fireEvent.click(view.getByText("Menu"));
  fireEvent.click(view.getByText("Generate Key Pair"));
  fireEvent.click(view.getByText("Menu"));
  fireEvent.click(view.getByText("Upload Public Key"));

  expect(spy.mock.results).toHaveLength(1);
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

  await waitFor(() => {
    expect(view.getByText(/sqlite worker: ready/)).toBeTruthy();
  });

  fireEvent.click(view.getByText("Menu"));
  fireEvent.click(view.getByText("Generate Key Pair"));
  fireEvent.click(view.getByText("Menu"));
  fireEvent.click(view.getByText("Upload Public Key"));

  expect(spy.mock.results).toHaveLength(1);
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

  await waitFor(() => {
    expect(view.getByText(/sqlite worker: ready/)).toBeTruthy();
  });

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
  const view = renderPane();

  await waitFor(() => {
    expect(view.getByText(/sqlite worker: ready/)).toBeTruthy();
  });

  fireEvent.click(view.getByText("Menu"));
  fireEvent.click(view.getByText("Generate Key Pair"));
  fireEvent.click(view.getByText("Menu"));
  fireEvent.click(view.getByText("Upload Public Key"));

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
