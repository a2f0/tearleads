import { afterEach, expect, test } from "bun:test";
import { hasPendingLocalDocumentWrites } from "@tearleads/client-sdk";
import {
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
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
import { InsurancePolicyFields } from "./InsurancePolicyApp";
import {
  type InsurancePolicyDocumentFields,
  readInsurancePolicyFieldValues,
} from "./insurancePolicyDocumentDefinition";

afterEach(async () => {
  cleanup();
  await cleanupPaneTestEnvironment();
}, MOCK_SERVER_RESET_TIMEOUT_MS);

function renderFields(
  source: Record<string, string>,
  overrides: Partial<Parameters<typeof InsurancePolicyFields>[0]> = {},
) {
  return render(
    <InsurancePolicyFields
      disabled={false}
      fields={readInsurancePolicyFieldValues(source)}
      isEditing
      onChange={() => undefined}
      ready
      {...overrides}
    />,
  );
}

test("choosing a policy type patches it and the type names the insured", () => {
  const patches: Array<Partial<InsurancePolicyDocumentFields>> = [];
  const view = renderFields(
    { policyType: "auto" },
    { onChange: (patch) => patches.push(patch) },
  );
  expect(view.getByLabelText("Insured Vehicle")).toBeTruthy();
  expect(view.queryByLabelText("Member ID")).toBeNull();
  expect(view.getByLabelText("Expiration Date").getAttribute("type")).toBe(
    "date",
  );

  fireEvent.click(view.getByRole("combobox", { name: "Policy type" }));
  const health = within(document.body)
    .getByText("Health")
    .closest('[role="option"]');
  if (!(health instanceof HTMLElement)) {
    throw new Error("Expected the Health option.");
  }
  fireEvent.click(health);
  fireEvent.change(view.getByLabelText("Insurer"), {
    target: { value: "Acme" },
  });
  expect(patches).toEqual([{ policyType: "health" }, { insurer: "Acme" }]);
});

test("a health policy offers member and prescription fields", () => {
  const view = renderFields({ policyType: "health" });
  for (const label of ["Member ID", "Group Number", "Rx BIN", "Rx PCN"]) {
    expect(view.getByLabelText(label)).toBeTruthy();
  }
  expect(view.getByLabelText("Covered Members")).toBeTruthy();
});

test("read mode shows the type's label and skips other variants' empty fields", () => {
  const view = renderFields(
    { insurer: "Acme Mutual", policyType: "home" },
    { isEditing: false },
  );
  expect(view.getByText("Home")).toBeTruthy();
  expect(view.queryByText("home")).toBeNull();
  expect(view.getByText("Acme Mutual")).toBeTruthy();
  expect(view.getByText("Insured Property")).toBeTruthy();
  expect(view.queryByText("Rx BIN")).toBeNull();
  expect(view.queryByRole("combobox")).toBeNull();
});

test(
  "Explorer records a health card with a PDF policy and reads it back after a restart",
  async () => {
    const storage = createPersistedPaneStorage();
    const localIdentityNamespace = "insurance-policy-reopen";
    const hostConfig = createTestHostConfig({
      localIdentityNamespace,
    }).withOverrides({ createSQLiteRuntime: storage.createRuntime });
    const { view, sdk } = renderLifecyclePane(hostConfig);
    await generateIdentityAndWaitForDb(view);
    const explorer = await openExplorer(view);
    const panel = within(explorer);
    await openExplorerNewStructuredDocumentRoute(explorer);
    fireEvent.click(panel.getByRole("button", { name: "Insurance Policy" }));

    const insurer = await waitFor(() => {
      const control = panel.getByRole<HTMLInputElement>("textbox", {
        name: "Insurer",
      });
      expect(control.disabled).toBe(false);
      return control;
    });
    fireEvent.change(insurer, { target: { value: "Acme Mutual" } });
    fireEvent.click(panel.getByRole("combobox", { name: "Policy type" }));
    fireEvent.click(
      within(document.body).getByRole("option", { name: "Health" }),
    );
    const rxBin = await panel.findByRole<HTMLInputElement>("textbox", {
      name: "Rx BIN",
    });
    fireEvent.change(rxBin, { target: { value: "610014" } });
    await waitFor(() => expect(rxBin.value).toBe("610014"));
    fireEvent.change(panel.getByLabelText("Policy Documents"), {
      target: {
        files: [
          new File(["%PDF-1.7"], "policy.pdf", { type: "application/pdf" }),
        ],
      },
    });
    await panel.findByText("policy.pdf");
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
        name: "Acme Mutual Health Insurance",
      }),
    );
    const restored = within(restarted);
    await waitFor(() => {
      expect(
        restored.getByText("Rx BIN").closest(".mini-app-row")?.textContent,
      ).toContain("610014");
      expect(restored.getByText("policy.pdf")).toBeTruthy();
    });
  },
  PANE_ASYNC_TEST_TIMEOUT_MS,
);
