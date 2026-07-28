import { afterEach, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { useBackupRestore } from "./BackupRestoreController";

type BackupRestoreModel = ReturnType<typeof useBackupRestore>;

// The tab UI is presentational over the shared controller, so drive it against a
// fake model rather than the full SQLite/identity runtime the real controller
// needs. `mock.module` is registered before the component is dynamically
// imported so the import binds to the fake.
function createModel(
  overrides: Partial<BackupRestoreModel> = {},
): BackupRestoreModel {
  return {
    backupPassword: "",
    busy: null,
    confirmBackupPassword: "",
    error: null,
    handleChooseRestoreFile: () => {},
    handleExportBackup: async () => {},
    handleReload: () => {},
    handleRestoreBackup: async () => {},
    handleRestoreFileChange: () => {},
    lastSummary: null,
    progress: null,
    restoreComplete: false,
    restoreFileInputRef: { current: null },
    restorePassword: "",
    selectedRestoreFileName: null,
    setBackupPassword: () => {},
    setConfirmBackupPassword: () => {},
    setRestorePassword: () => {},
    status: null,
    ...overrides,
  };
}

let activeModel = createModel();

mock.module("./BackupRestoreController", () => ({
  useBackupRestore: () => activeModel,
}));

const { BackupRestore } = await import("./BackupRestore");

afterEach(() => {
  cleanup();
  activeModel = createModel();
});

test("exposes Backup and Restore as separate tabs, Backup first", () => {
  const view = render(<BackupRestore />);

  const tabs = view.getAllByRole("tab");
  expect(tabs.map((tab) => tab.textContent)).toEqual(["Backup", "Restore"]);
  expect(
    view.getByRole("tab", { name: "Backup" }).getAttribute("aria-selected"),
  ).toBe("true");
});

test("Backup tab shows the export form and hides the restore form", () => {
  const view = render(<BackupRestore />);

  expect(view.queryByRole("button", { name: "Export Backup" })).toBeTruthy();
  expect(view.queryByRole("button", { name: "Restore Backup" })).toBeNull();
  expect(view.queryByRole("button", { name: "Choose Backup File" })).toBeNull();
});

test("selecting the Restore tab swaps to the restore form", () => {
  const view = render(<BackupRestore />);

  fireEvent.click(view.getByRole("tab", { name: "Restore" }));

  expect(
    view.getByRole("tab", { name: "Restore" }).getAttribute("aria-selected"),
  ).toBe("true");
  expect(view.queryByRole("button", { name: "Restore Backup" })).toBeTruthy();
  expect(
    view.queryByRole("button", { name: "Choose Backup File" }),
  ).toBeTruthy();
  expect(view.queryByRole("button", { name: "Export Backup" })).toBeNull();
});

test("shared status stays visible regardless of the active tab", () => {
  activeModel = createModel({ error: "Backup passwords do not match." });
  const view = render(<BackupRestore />);

  // The error line lives above the tabs, so it shows on the Restore tab too.
  fireEvent.click(view.getByRole("tab", { name: "Restore" }));
  expect(view.queryByText("Backup passwords do not match.")).toBeTruthy();
});

// "Choose Backup File" lives inside the restore <form>, so it must not act as a
// submit button (which would fire handleRestoreBackup before a file is picked).
// MiniAppButton defaults type="button"; this guards that it stays that way.
test("Choose Backup File does not submit the restore form", () => {
  const handleChooseRestoreFile = mock(() => {});
  const handleRestoreBackup = mock(async () => {});
  activeModel = createModel({ handleChooseRestoreFile, handleRestoreBackup });
  const view = render(<BackupRestore />);

  fireEvent.click(view.getByRole("tab", { name: "Restore" }));
  fireEvent.click(view.getByRole("button", { name: "Choose Backup File" }));

  expect(handleChooseRestoreFile).toHaveBeenCalledTimes(1);
  expect(handleRestoreBackup).not.toHaveBeenCalled();
});
