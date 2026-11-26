import { afterEach, expect, test } from "bun:test";
import { hasPendingLocalDocumentWrites } from "@tearleads/client-sdk";
import {
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { MOCK_SERVER_RESET_TIMEOUT_MS } from "../../../test/helpers/msw/server";
import { renderLifecyclePane } from "../../../test/helpers/paneLifecycleTestUtils";
import {
  cleanupPaneTestEnvironment,
  createTestHostConfig,
  generateIdentityAndWaitForDb,
  getPaneStatusText,
  openExplorer,
  openExplorerNewStructuredDocumentRoute,
  PANE_ASYNC_TEST_TIMEOUT_MS,
  renderPane,
  waitForPersistedPaneLocalIdentity,
} from "../../../test/helpers/paneTestUtils";
import { createPersistedPaneStorage } from "../../../test/helpers/persistedPaneStorage";
import { LicenseFields } from "./LicenseApp";
import {
  type LicenseDocumentFields,
  readLicenseFieldValues,
} from "./licenseDocumentDefinition";

afterEach(async () => {
  cleanup();
  await cleanupPaneTestEnvironment();
}, MOCK_SERVER_RESET_TIMEOUT_MS);

function renderFields(
  source: Record<string, string>,
  overrides: Partial<Parameters<typeof LicenseFields>[0]> = {},
) {
  return render(
    <LicenseFields
      disabled={false}
      fields={readLicenseFieldValues(source)}
      isEditing
      onChange={() => undefined}
      ready
      {...overrides}
    />,
  );
}

test("choosing a license type patches it and offers that type's fields", () => {
  const patches: Array<Partial<LicenseDocumentFields>> = [];
  const view = renderFields(
    { licenseType: "concealed_carry" },
    { onChange: (patch) => patches.push(patch) },
  );
  expect(view.getByLabelText("Permit Number")).toBeTruthy();
  expect(view.getByLabelText("Class or Restrictions")).toBeTruthy();
  expect(view.queryByLabelText("Privileges and Stamps")).toBeNull();
  expect(view.getByLabelText("Expiration Date").getAttribute("type")).toBe(
    "date",
  );

  fireEvent.click(view.getByRole("combobox", { name: "License type" }));
  fireEvent.click(
    within(document.body).getByRole("option", { name: "Fishing License" }),
  );
  fireEvent.change(view.getByLabelText("Issued In"), {
    target: { value: "Texas" },
  });
  expect(patches).toEqual([
    { licenseType: "fishing" },
    { jurisdiction: "Texas" },
  ]);
});

test("a wildlife license picks its residency from a list", () => {
  const patches: Array<Partial<LicenseDocumentFields>> = [];
  const view = renderFields(
    { licenseType: "hunting_fishing" },
    { onChange: (patch) => patches.push(patch) },
  );
  for (const label of [
    "Customer ID",
    "Privileges and Stamps",
    "License Number",
  ]) {
    expect(view.getByLabelText(label)).toBeTruthy();
  }
  expect(view.queryByLabelText("Class or Restrictions")).toBeNull();

  fireEvent.click(view.getByRole("combobox", { name: "Residency" }));
  // An empty field has nothing to clear, so it offers no "None".
  expect(
    within(document.body)
      .getAllByRole("option")
      .map((option) => option.textContent?.trim()),
  ).toEqual(["Resident", "Nonresident"]);
  fireEvent.click(
    within(document.body).getByRole("option", { name: "Nonresident" }),
  );
  expect(patches).toEqual([{ residency: "nonresident" }]);
});

function EditableLicenseFields(props: {
  initial: Record<string, string>;
  isEditing: boolean;
}) {
  const [fields, setFields] = useState(() =>
    readLicenseFieldValues(props.initial),
  );
  return (
    <LicenseFields
      disabled={false}
      fields={fields}
      isEditing={props.isEditing}
      onChange={(patch) => setFields((current) => ({ ...current, ...patch }))}
      ready
    />
  );
}

test("a picked residency can be cleared, and then hides on a type without it", () => {
  const initial = { licenseType: "boating", residency: "resident" };
  const view = render(<EditableLicenseFields initial={initial} isEditing />);
  const residency = view.getByRole("combobox", { name: "Residency" });
  expect(residency.textContent).toContain("Resident");

  fireEvent.click(residency);
  fireEvent.click(within(document.body).getByRole("option", { name: "None" }));
  // The cleared input stays for the rest of the edit, showing its placeholder.
  expect(
    view.getByRole("combobox", { name: "Residency" }).textContent,
  ).toContain("Select residency");

  view.rerender(<EditableLicenseFields initial={initial} isEditing={false} />);
  expect(view.getByText("Boating License")).toBeTruthy();
  expect(view.queryByText("Residency")).toBeNull();
});

test("read mode shows option labels and skips other variants' empty fields", () => {
  const view = renderFields(
    {
      jurisdiction: "Montana",
      licenseType: "hunting",
      residency: "resident",
    },
    { isEditing: false },
  );
  expect(view.getByText("Hunting License")).toBeTruthy();
  expect(view.queryByText("hunting")).toBeNull();
  expect(view.getByText("Resident")).toBeTruthy();
  expect(view.queryByText("resident")).toBeNull();
  expect(view.getByText("Montana")).toBeTruthy();
  expect(view.getByText("Privileges and Stamps")).toBeTruthy();
  expect(view.queryByText("Class or Restrictions")).toBeNull();
  expect(view.queryByRole("combobox")).toBeNull();
});

test(
  "Explorer records a hunting license with a PDF and reads it back after a restart",
  async () => {
    const storage = createPersistedPaneStorage();
    const localIdentityNamespace = "license-reopen";
    const hostConfig = createTestHostConfig({
      localIdentityNamespace,
    }).withOverrides({ createSQLiteRuntime: storage.createRuntime });
    const { view, sdk } = renderLifecyclePane(hostConfig);
    await generateIdentityAndWaitForDb(view);
    const explorer = await openExplorer(view);
    const panel = within(explorer);
    await openExplorerNewStructuredDocumentRoute(explorer);
    fireEvent.click(panel.getByRole("button", { name: "License or Permit" }));

    const issuedIn = await waitFor(() => {
      const control = panel.getByRole<HTMLInputElement>("textbox", {
        name: "Issued In",
      });
      expect(control.disabled).toBe(false);
      return control;
    });
    fireEvent.change(issuedIn, { target: { value: "Montana" } });
    fireEvent.click(panel.getByRole("combobox", { name: "License type" }));
    fireEvent.click(
      within(document.body).getByRole("option", { name: "Hunting License" }),
    );
    const privileges = await panel.findByRole<HTMLInputElement>("textbox", {
      name: "Privileges and Stamps",
    });
    fireEvent.change(privileges, { target: { value: "Deer archery" } });
    await waitFor(() => expect(privileges.value).toBe("Deer archery"));
    fireEvent.change(panel.getByLabelText("License Documents"), {
      target: {
        files: [
          new File(["%PDF-1.7"], "license.pdf", { type: "application/pdf" }),
        ],
      },
    });
    await panel.findByText("license.pdf");
    fireEvent.click(panel.getByRole("button", { name: "Done" }));
    expect(await panel.findByText("PDF document")).toBeTruthy();
    await waitFor(() =>
      expect(hasPendingLocalDocumentWrites(sdk().domainScope)).toBe(false),
    );
    await waitForPersistedPaneLocalIdentity(localIdentityNamespace);
    view.unmount();
    await waitFor(
      () =>
        expect(storage.workers.every((worker) => worker.terminated)).toBe(true),
      { timeout: PANE_ASYNC_TEST_TIMEOUT_MS },
    );

    const reopened = renderPane({ hostConfig });
    await waitFor(
      () =>
        expect(getPaneStatusText(reopened)).toMatch(/sqlite worker:\s*ready/u),
      { timeout: PANE_ASYNC_TEST_TIMEOUT_MS },
    );
    const restarted = await openExplorer(reopened);
    fireEvent.click(
      await within(restarted).findByRole("button", {
        name: "Montana Hunting License",
      }),
    );
    const restored = within(restarted);
    await waitFor(() => {
      expect(
        restored.getByText("Privileges and Stamps").closest(".mini-app-row")
          ?.textContent,
      ).toContain("Deer archery");
      expect(restored.getByText("license.pdf")).toBeTruthy();
    });
  },
  PANE_ASYNC_TEST_TIMEOUT_MS,
);
