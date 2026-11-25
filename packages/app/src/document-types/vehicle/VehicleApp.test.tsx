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
import { VehicleFields } from "./VehicleApp";
import {
  readVehicleFieldValues,
  type VehicleDocumentFields,
} from "./vehicleDocumentDefinition";

afterEach(async () => {
  cleanup();
  await cleanupPaneTestEnvironment();
}, MOCK_SERVER_RESET_TIMEOUT_MS);

test("the editor uppercases the VIN and currency and dates use date inputs", () => {
  const patches: Array<Partial<VehicleDocumentFields>> = [];
  const view = render(
    <VehicleFields
      disabled={false}
      fields={readVehicleFieldValues({})}
      isEditing
      onChange={(patch) => patches.push(patch)}
      ready
    />,
  );
  fireEvent.change(view.getByLabelText("VIN"), {
    target: { value: "jtmw1" },
  });
  fireEvent.change(view.getByLabelText("Purchase Currency"), {
    target: { value: "usd" },
  });
  fireEvent.change(view.getByLabelText("Make"), {
    target: { value: "Toyota" },
  });
  expect(patches).toEqual([
    { vin: "JTMW1" },
    { purchaseCurrency: "USD" },
    { make: "Toyota" },
  ]);
  expect(
    view.getByLabelText("Registration Expiration").getAttribute("type"),
  ).toBe("date");
});

test(
  "Explorer logs a service and an untyped PDF title and reads both back after a restart",
  async () => {
    const storage = createPersistedPaneStorage();
    const localIdentityNamespace = "vehicle-reopen";
    const hostConfig = createTestHostConfig({
      localIdentityNamespace,
    }).withOverrides({ createSQLiteRuntime: storage.createRuntime });
    const { view, sdk } = renderLifecyclePane(hostConfig);
    await generateIdentityAndWaitForDb(view);
    const explorer = await openExplorer(view);
    const panel = within(explorer);
    await openExplorerNewStructuredDocumentRoute(explorer);
    fireEvent.click(panel.getByRole("button", { name: "Vehicle" }));

    for (const [name, value] of [
      ["Year", "2021"],
      ["Make", "Toyota"],
      ["Model", "RAV4"],
    ] as const) {
      const input = await waitFor(() => {
        const control = panel.getByRole<HTMLInputElement>("textbox", { name });
        expect(control.disabled).toBe(false);
        return control;
      });
      fireEvent.change(input, { target: { value } });
      await waitFor(() => expect(input.value).toBe(value));
    }
    fireEvent.change(panel.getByLabelText("Title"), {
      target: { files: [new File(["%PDF-1.7"], "title.pdf", { type: "" })] },
    });
    await panel.findByText("title.pdf");

    fireEvent.click(panel.getByRole("button", { name: "Add Service" }));
    const unit = panel.getByRole<HTMLSelectElement>("combobox", {
      name: "New service unit",
    });
    expect(unit.value).toBe("mi");
    fireEvent.change(panel.getByLabelText("New service odometer"), {
      target: { value: "45120" },
    });
    const save = panel.getByRole<HTMLButtonElement>("button", {
      name: "Save Service",
    });
    // Work performed is required before a service can be added.
    expect(save.disabled).toBe(true);
    fireEvent.change(panel.getByLabelText("New service work performed"), {
      target: { value: "Oil change" },
    });
    await waitFor(() => expect(save.disabled).toBe(false));
    fireEvent.click(save);
    await panel.findByDisplayValue("Oil change");
    fireEvent.click(panel.getByRole("button", { name: "Save" }));
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
        name: "2021 Toyota RAV4",
      }),
    );
    const restored = within(restarted);
    await waitFor(() => {
      const table = restored.getByRole("table", { name: "Service History" });
      expect(table.textContent).toContain("Oil change");
      expect(table.textContent).toContain("45120 mi");
      expect(restored.getByText("title.pdf")).toBeTruthy();
    });
  },
  PANE_ASYNC_TEST_TIMEOUT_MS,
);
