import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import type { SaveFileRequest } from "@tearleads/client-sdk";
import {
  act,
  fireEvent,
  render,
  renderHook,
  waitFor,
} from "@testing-library/react";
import { createDeferred } from "../../../test/helpers/databaseRuntimeFactories";
import {
  cleanupIdentityManagerTestEnvironment,
  createIdentityManagerHostConfig,
  TestWebSocket,
} from "../../../test/helpers/identityManagerTestRuntime";
import { AppRuntimeProvider } from "../../providers/AppRuntimeProvider";
import {
  backupFileRequiresPassword,
  decodeBackupFile,
  encodeBackupFile,
} from "../../providers/db/localBackupFormat";
import {
  type BackupProgress,
  useLocalBackupOperations,
} from "../../providers/db/useLocalBackupOperations";
import { BackupRestore } from "./BackupRestore";

const originalWebSocket = globalThis.WebSocket;

beforeAll(() => {
  Reflect.set(globalThis, "WebSocket", TestWebSocket);
});
afterAll(() => {
  Reflect.set(globalThis, "WebSocket", originalWebSocket);
});
afterEach(cleanupIdentityManagerTestEnvironment);

function renderBackupRestore(saveGate?: Promise<void>) {
  const savedFiles: SaveFileRequest[] = [];
  const hostConfig = createIdentityManagerHostConfig().withOverrides({
    createFileSaver: () => ({
      async saveFile(request) {
        savedFiles.push(request);
        await saveGate;
      },
    }),
  });
  const view = render(
    <AppRuntimeProvider autoProvisionEnabled={false} hostConfig={hostConfig}>
      <BackupRestore />
    </AppRuntimeProvider>,
  );
  return { ...view, savedFiles };
}

type BackupRestoreView = ReturnType<typeof renderBackupRestore>;

function chooseBackup(view: BackupRestoreView, text: string | Promise<string>) {
  fireEvent.change(view.getByLabelText("Backup Restore File"), {
    target: {
      files: [{ name: "test.tlbackup.json", text: async () => text }],
    },
  });
}

async function exportBackup(view: BackupRestoreView, password?: string) {
  if (password !== undefined) {
    fireEvent.change(view.getByLabelText("Password"), {
      target: { value: password },
    });
    fireEvent.change(view.getByLabelText("Confirm Password"), {
      target: { value: password },
    });
  } else {
    fireEvent.click(view.getByRole("checkbox"));
  }
  fireEvent.click(view.getByRole("button", { name: "Export Backup" }));
  await waitFor(() =>
    expect(view.queryByText(/Backup exported:/)).toBeTruthy(),
  );
  const savedFile = view.savedFiles[0];
  if (!savedFile) throw new Error("Backup was not saved.");
  return new TextDecoder().decode(savedFile.data);
}

test("exposes Backup and Restore as separate tabs, Backup first", () => {
  const view = renderBackupRestore();
  expect(view.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
    "Backup",
    "Restore",
  ]);
  expect(
    view.getByRole("tab", { name: "Backup" }).getAttribute("aria-selected"),
  ).toBe("true");
  expect(view.queryByRole("button", { name: "Export Backup" })).toBeTruthy();
  expect(view.queryByRole("button", { name: "Restore Backup" })).toBeNull();
  expect(view.queryByRole("button", { name: "Choose Backup File" })).toBeNull();
});

test("selecting the Restore tab swaps to the restore form", () => {
  const view = renderBackupRestore();
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

test("requires matching passwords unless the checkbox is checked", () => {
  const view = renderBackupRestore();
  fireEvent.click(view.getByRole("button", { name: "Export Backup" }));
  expect(view.queryByText("Enter a backup password.")).toBeTruthy();
  fireEvent.change(view.getByLabelText("Password"), {
    target: { value: "password" },
  });
  fireEvent.click(view.getByRole("button", { name: "Export Backup" }));
  expect(view.queryByText("Backup passwords do not match.")).toBeTruthy();
  expect(view.savedFiles).toHaveLength(0);
  fireEvent.click(view.getByRole("tab", { name: "Restore" }));
  expect(view.queryByText("Backup passwords do not match.")).toBeTruthy();
});

test("Choose Backup File does not submit the restore form", () => {
  const view = renderBackupRestore();
  fireEvent.click(view.getByRole("tab", { name: "Restore" }));
  fireEvent.click(view.getByRole("button", { name: "Choose Backup File" }));
  expect(view.queryByText("Choose a backup file.")).toBeNull();
});

test("the checkbox hides both password fields and restores them when unchecked", () => {
  const view = renderBackupRestore();
  const checkbox = view.getByRole("checkbox", {
    name: "Back up without a password",
  });
  expect(view.queryByLabelText("Password")).toBeTruthy();
  expect(view.queryByLabelText("Confirm Password")).toBeTruthy();
  fireEvent.click(checkbox);
  expect(view.queryByLabelText("Password")).toBeNull();
  expect(view.queryByLabelText("Confirm Password")).toBeNull();
  fireEvent.click(checkbox);
  expect(view.queryByLabelText("Password")).toBeTruthy();
  expect(view.queryByLabelText("Confirm Password")).toBeTruthy();
});

test("exports without a password despite stale mismatched fields and restores without prompting", async () => {
  const view = renderBackupRestore();
  fireEvent.change(view.getByLabelText("Password"), {
    target: { value: "unused-password" },
  });
  const text = await exportBackup(view);
  expect(backupFileRequiresPassword(text)).toBe(false);

  fireEvent.click(view.getByRole("tab", { name: "Restore" }));
  chooseBackup(view, text);
  await waitFor(() => expect(view.queryByLabelText("Password")).toBeNull());
  fireEvent.click(view.getByRole("button", { name: "Restore Backup" }));
  await waitFor(() =>
    expect(view.queryByText(/Backup restored:/)).toBeTruthy(),
  );
  expect(view.queryByRole("button", { name: "Reload App" })).toBeTruthy();
  expect(view.queryByLabelText("Password")).toBeTruthy();
});

test("encrypted backups still require the correct password and can be retried", async () => {
  const view = renderBackupRestore();
  const text = await exportBackup(view, "test-password");
  expect(backupFileRequiresPassword(text)).toBe(true);
  fireEvent.click(view.getByRole("tab", { name: "Restore" }));
  await act(async () => chooseBackup(view, text));
  fireEvent.click(view.getByRole("button", { name: "Restore Backup" }));
  expect(view.queryByText("Enter the restore password.")).toBeTruthy();
  fireEvent.change(view.getByLabelText("Password"), {
    target: { value: "wrong-password" },
  });
  fireEvent.click(view.getByRole("button", { name: "Restore Backup" }));
  await waitFor(() =>
    expect(view.queryByText(/Backup password is incorrect/)).toBeTruthy(),
  );
  fireEvent.change(view.getByLabelText("Password"), {
    target: { value: "test-password" },
  });
  fireEvent.click(view.getByRole("button", { name: "Restore Backup" }));
  await waitFor(() =>
    expect(view.queryByText(/Backup restored:/)).toBeTruthy(),
  );
});

test("the password option is disabled while the backup is being saved", async () => {
  const gate = createDeferred();
  const view = renderBackupRestore(gate.promise);
  try {
    fireEvent.click(view.getByRole("checkbox"));
    fireEvent.click(view.getByRole("button", { name: "Export Backup" }));
    await waitFor(() => expect(view.savedFiles).toHaveLength(1));
    expect(view.queryByText(/Encrypting backup/)).toBeNull();
    expect(view.getByRole("checkbox").hasAttribute("disabled")).toBe(true);
    expect(
      view
        .getByRole("button", { name: "Export Backup" })
        .hasAttribute("disabled"),
    ).toBe(true);
  } finally {
    await act(async () => gate.resolve());
  }
  expect(view.getByRole("checkbox").hasAttribute("disabled")).toBe(false);
});

test("switching files clears stale restore data and ignores superseded file reads", async () => {
  const view = renderBackupRestore();
  const plaintext = await exportBackup(view);
  const payload = await decodeBackupFile({ text: plaintext });
  const encrypted = await encodeBackupFile({ password: "password", payload });
  fireEvent.click(view.getByRole("tab", { name: "Restore" }));
  await act(async () => chooseBackup(view, plaintext));
  expect(view.queryByLabelText("Password")).toBeNull();

  const slowFile = createDeferred<string>();
  chooseBackup(view, slowFile.promise);
  fireEvent.click(view.getByRole("button", { name: "Restore Backup" }));
  expect(view.queryByText("Choose a backup file.")).toBeTruthy();
  await act(async () => chooseBackup(view, encrypted));
  await act(async () => slowFile.resolve(plaintext));
  expect(view.queryByLabelText("Password")).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "Restore Backup" }));
  expect(view.queryByText("Enter the restore password.")).toBeTruthy();
});

test.each([
  undefined,
  "password",
])("backup progress matches encryption (password: %s)", async (password) => {
  const hostConfig = createIdentityManagerHostConfig();
  const { result } = renderHook(useLocalBackupOperations, {
    wrapper: ({ children }) => (
      <AppRuntimeProvider autoProvisionEnabled={false} hostConfig={hostConfig}>
        {children}
      </AppRuntimeProvider>
    ),
  });
  const exportProgress: BackupProgress["phase"][] = [];
  const restoreProgress: BackupProgress["phase"][] = [];
  await act(async () => {
    const backup = await result.current.exportLocalBackup({
      onProgress: ({ phase }) => exportProgress.push(phase),
      password,
    });
    await result.current.restoreLocalBackup({
      onProgress: ({ phase }) => restoreProgress.push(phase),
      password,
      text: backup.text,
    });
  });
  expect(exportProgress).toContain("preparing");
  expect(exportProgress.includes("encrypting")).toBe(password !== undefined);
  expect(restoreProgress).toContain("preparing");
  expect(restoreProgress.includes("decrypting")).toBe(password !== undefined);
  expect(restoreProgress).toContain("restoring");
});
