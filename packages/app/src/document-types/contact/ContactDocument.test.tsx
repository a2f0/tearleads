import { afterEach, expect, mock, spyOn, test } from "bun:test";
import {
  createDomainScope,
  type DocumentRow,
  type DocumentSnapshot,
  type DocumentStore,
  type Tearleads,
} from "@tearleads/client-sdk";
import {
  useWindowTitleBarActions,
  WindowMenuProvider,
} from "@tearleads/windowing";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import { createAppHostConfig } from "../../host/AppHostConfig";
import { AppHostConfigProvider } from "../../providers/host/AppHostConfigProvider";
import * as Runtime from "../../providers/sdk/TearleadsProvider";
import {
  DocumentContext,
  DocumentReadOnlyContext,
} from "../../stores/documents/DocumentsProvider";
import { ContactDocument, ContactDocumentFields } from "./ContactDocument";
import type { ContactFieldValues } from "./contactFieldDescriptors";

const restorers: Array<() => void> = [];
afterEach(() => {
  cleanup();
  for (const restore of restorers.splice(0)) restore();
});

const values: ContactFieldValues = {
  firstName: "Ada",
  lastName: "Lovelace",
  nickname: "Countess",
};

const hostConfig = createAppHostConfig({
  apiBaseUrl: "http://api.example.test",
  wsUrl: "ws://api.example.test/events",
});

function row(id: string, fields: Record<string, string>): DocumentRow {
  return {
    id,
    fields,
    createdAt: "",
    createdBy: "untrusted",
    createdByPeer: null,
    updatedAt: "",
    updatedBy: "untrusted",
    updatedByPeer: null,
    fieldEditors: {},
  };
}

function documentFixture(documentId: string | null = "contact-1") {
  let snapshot: DocumentSnapshot = {
    attachments: [],
    attachmentStatusBySlotId: {},
    attachmentStorageKeyBySlotId: {},
    canAttach: false,
    canWrite: true,
    currentAuthorId: null,
    documentId,
    documentKind: "contact",
    effectiveAccessLevel: "write",
    fieldValidationIssues: [],
    ready: true,
    rows: [
      row("home-id", {
        recordType: "postalAddress",
        label: "Home",
        street: "Explorer street",
      }),
    ],
    structuredFields: { firstName: "Ada" },
    syncing: false,
    text: "",
    title: "Ada",
  };
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<DocumentSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    for (const listener of listeners) listener();
  };
  const methods = {
    addRow: mock(async (fields: Record<string, string>) => {
      publish({ rows: [...snapshot.rows, row("added-id", fields)] });
      return "added-id";
    }),
    updateRowFields: mock(async (id: string, patch: Record<string, string>) => {
      publish({
        rows: snapshot.rows.map((entry) =>
          entry.id === id
            ? { ...entry, fields: { ...entry.fields, ...patch } }
            : entry,
        ),
      });
    }),
    removeRow: mock(async (id: string) => {
      publish({ rows: snapshot.rows.filter((entry) => entry.id !== id) });
    }),
    hasUnsavedLocalEdits: mock(() => false),
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    attachFiles: () => undefined,
    removeAttachment: () => undefined,
    replaceAttachment: async () => undefined,
    requestSync: () => undefined,
    relink: async () => null,
    setStructuredFields: async () => undefined,
    setText: async () => undefined,
  };
  return { methods, publish, store: methods as unknown as DocumentStore };
}

function setupRuntime() {
  const runtime = {
    auth: {
      authToken: null,
      isAuthenticated: false,
      organizationId: null,
      userId: null,
    },
    crypto: { signingFingerprint: null },
    infra: { blobStore: {} },
    state: { online: false, domainScope: createDomainScope() },
  };
  const runtimeSpy = spyOn(Runtime, "useTearleadsRuntime").mockReturnValue(
    runtime as unknown as Runtime.RuntimeSnapshot,
  );
  const sdkSpy = spyOn(Runtime, "useTearleads").mockReturnValue({
    containerContents: { loadDocumentEditAttribution: async () => null },
  } as unknown as Tearleads);
  restorers.push(
    () => runtimeSpy.mockRestore(),
    () => sdkSpy.mockRestore(),
  );
  return { runtime, sdkSpy };
}

function documentTree(store: DocumentStore, readOnly = false) {
  return (
    <AppHostConfigProvider value={hostConfig}>
      <WindowMenuProvider>
        <DocumentContext.Provider value={store}>
          <DocumentReadOnlyContext.Provider value={readOnly}>
            <ContactDocument initialEditing />
          </DocumentReadOnlyContext.Provider>
        </DocumentContext.Provider>
      </WindowMenuProvider>
    </AppHostConfigProvider>
  );
}

test("Explorer renders contact rows and saves only the edited address field", async () => {
  setupRuntime();
  const fixture = documentFixture();
  const view = render(documentTree(fixture.store));
  expect(view.getByText("Explorer street")).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "Edit address" }));
  fireEvent.change(view.getByLabelText("Street address"), {
    target: { value: "Changed in Explorer" },
  });
  fireEvent.click(view.getByRole("button", { name: "Save address" }));
  await waitFor(() =>
    expect(view.getByText("Changed in Explorer")).toBeTruthy(),
  );
  expect(fixture.methods.updateRowFields).toHaveBeenCalledWith("home-id", {
    street: "Changed in Explorer",
  });
  await waitFor(() =>
    expect(view.queryByRole("form", { name: "Address editor" })).toBeNull(),
  );
  fireEvent.click(view.getByRole("button", { name: "Add address" }));
  fireEvent.change(view.getByLabelText("Label"), { target: { value: "Work" } });
  fireEvent.change(view.getByLabelText("Postal code"), {
    target: { value: "00042" },
  });
  fireEvent.click(view.getByRole("button", { name: "Save address" }));
  await waitFor(() => expect(view.getByText("00042")).toBeTruthy());
  expect(fixture.methods.addRow).toHaveBeenCalledWith({
    recordType: "postalAddress",
    label: "Work",
    street: "",
    extendedAddress: "",
    locality: "",
    region: "",
    postalCode: "00042",
    countryCode: "",
  });
  await waitFor(() =>
    expect(view.queryByRole("form", { name: "Address editor" })).toBeNull(),
  );
  fireEvent.click(
    within(view.getByRole("group", { name: "Work" })).getByRole("button", {
      name: "Remove address",
    }),
  );
  await waitFor(() =>
    expect(view.queryByRole("group", { name: "Work" })).toBeNull(),
  );
  expect(fixture.methods.removeRow).toHaveBeenCalledWith("added-id");
});

test.each(["add", "update", "remove"] as const)(
  "Explorer reports a swallowed %s failure rather than success",
  async (operation) => {
    setupRuntime();
    const fixture = documentFixture();
    fixture.methods.addRow.mockImplementation(async () => "not-persisted");
    fixture.methods.updateRowFields.mockImplementation(async () => undefined);
    fixture.methods.removeRow.mockImplementation(async () => undefined);
    const view = render(documentTree(fixture.store));
    if (operation === "remove") {
      fireEvent.click(view.getByRole("button", { name: "Remove address" }));
    } else {
      fireEvent.click(
        view.getByRole("button", {
          name: operation === "add" ? "Add address" : "Edit address",
        }),
      );
      fireEvent.change(view.getByLabelText("Street address"), {
        target: { value: "Unsaved street" },
      });
      fireEvent.click(view.getByRole("button", { name: "Save address" }));
    }
    await waitFor(() =>
      expect(view.getByRole("alert").textContent).toContain(
        "could not be saved",
      ),
    );
    if (operation !== "remove")
      expect(
        (view.getByLabelText("Street address") as HTMLInputElement).value,
      ).toBe("Unsaved street");
  },
);

test("Explorer does not acknowledge in-memory edits that failed persistence", async () => {
  setupRuntime();
  const fixture = documentFixture();
  fixture.methods.hasUnsavedLocalEdits.mockReturnValue(true);
  const view = render(documentTree(fixture.store));
  fireEvent.click(view.getByRole("button", { name: "Edit address" }));
  fireEvent.change(view.getByLabelText("Street address"), {
    target: { value: "Unsaved memory value" },
  });
  fireEvent.click(view.getByRole("button", { name: "Save address" }));
  await waitFor(() =>
    expect(view.getByRole("alert").textContent).toContain("could not be saved"),
  );
  expect(view.getByRole("form", { name: "Address editor" })).toBeTruthy();
});

test("Explorer switches local documents without retaining drafts or late completions", async () => {
  setupRuntime();
  const first = documentFixture(null);
  const second = documentFixture(null);
  const pending = Promise.withResolvers<void>();
  first.methods.updateRowFields.mockImplementation(() => pending.promise);
  const view = render(documentTree(first.store));
  fireEvent.click(view.getByRole("button", { name: "Edit address" }));
  fireEvent.change(view.getByLabelText("Street address"), {
    target: { value: "First draft" },
  });
  fireEvent.click(view.getByRole("button", { name: "Save address" }));
  await waitFor(() =>
    expect(first.methods.updateRowFields).toHaveBeenCalledTimes(1),
  );
  view.rerender(documentTree(second.store));
  expect(view.queryByRole("form", { name: "Address editor" })).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Edit address" }));
  fireEvent.change(view.getByLabelText("Street address"), {
    target: { value: "Second draft" },
  });
  await act(async () => pending.resolve());
  expect(
    (view.getByLabelText("Street address") as HTMLInputElement).value,
  ).toBe("Second draft");
  expect(view.queryByRole("alert")).toBeNull();
  expect(second.methods.updateRowFields).not.toHaveBeenCalled();
});

test("Explorer resolves address attribution from signed uploader segments", async () => {
  const context = setupRuntime();
  context.runtime.auth.isAuthenticated = true;
  context.runtime.state.online = true;
  context.sdkSpy.mockReturnValue({
    containerContents: {
      loadDocumentEditAttribution: async () => ({
        documentId: "contact-1",
        attributionRevision: 1,
        segments: [
          {
            authorityKind: "direct",
            peerId: "7",
            startCounter: 0,
            endCounter: 5,
            writerUserId: "uploader",
            writerKeyFingerprint: "fingerprint",
          },
        ],
      }),
    },
  } as unknown as Tearleads);
  const fixture = documentFixture();
  fixture.publish({
    rows: [
      {
        ...row("home-id", {
          recordType: "postalAddress",
          street: "Explorer street",
        }),
        fieldEditors: { street: "7" },
        createdAt: "2026-01-01T10:00:00Z",
        createdByPeer: "7",
      },
    ],
  });
  const view = render(documentTree(fixture.store));
  fireEvent.click(view.getByRole("button", { name: "Details / attribution" }));
  const dialog = within(view.getByRole("dialog"));
  await waitFor(() => expect(dialog.getByText("set by uploader")).toBeTruthy());
  expect(dialog.getByText(/2026-01-01 10:00 by uploader/)).toBeTruthy();
  expect(dialog.queryByText(/untrusted/)).toBeNull();
  expect(dialog.getAllByText("Unknown").length).toBeGreaterThan(0);
});

test.each(["trash", "permission", "hydration"] as const)(
  "Explorer %s guard prevents address writes and retains a local draft",
  async (gate) => {
    setupRuntime();
    const fixture = documentFixture();
    const view = render(documentTree(fixture.store));
    fireEvent.click(view.getByRole("button", { name: "Edit address" }));
    fireEvent.change(view.getByLabelText("Street address"), {
      target: { value: "Preserved" },
    });
    if (gate === "trash") view.rerender(documentTree(fixture.store, true));
    else
      await act(async () =>
        fixture.publish(
          gate === "hydration" ? { ready: false } : { canWrite: false },
        ),
      );
    fireEvent.submit(view.getByRole("form", { name: "Address editor" }));
    expect(fixture.methods.updateRowFields).not.toHaveBeenCalled();
    expect(fixture.methods.addRow).not.toHaveBeenCalled();
    expect(fixture.methods.removeRow).not.toHaveBeenCalled();
    expect(
      (view.getByLabelText("Street address") as HTMLInputElement).value,
    ).toBe("Preserved");
    expect(
      (view.getByLabelText("Street address") as HTMLInputElement).disabled,
    ).toBe(true);
  },
);

function ToolbarProbe() {
  const actions = useWindowTitleBarActions();

  return (
    <div aria-label="Toolbar" role="toolbar">
      {actions.map((action) => (
        <button
          aria-label={action.label}
          disabled={action.disabled}
          key={action.id}
          type="button"
          onClick={action.onClick}
        />
      ))}
    </div>
  );
}

test("contact document edits from the toolbar", async () => {
  let toggleCount = 0;
  const view = render(
    <AppHostConfigProvider value={hostConfig}>
      <WindowMenuProvider>
        <ToolbarProbe />
        <ContactDocumentFields
          canWrite={true}
          isEditing={false}
          ready={true}
          toggleEditing={() => {
            toggleCount += 1;
          }}
          setStructuredFields={async () => undefined}
          values={values}
        />
      </WindowMenuProvider>
    </AppHostConfigProvider>,
  );

  await waitFor(() => {
    expect(view.getByRole("button", { name: "Edit" })).toBeTruthy();
  });
  expect(view.container.querySelector(".mini-app-actions")).toBeNull();

  fireEvent.click(view.getByRole("button", { name: "Edit" }));

  expect(toggleCount).toBe(1);
});
