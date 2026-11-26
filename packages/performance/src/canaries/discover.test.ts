import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import {
  appRoot,
  discoverCanaries,
  isCanarySource,
  selectCanaries,
} from "./discover";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function appWith(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "canaries-"));
  directories.push(root);
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(resolve(root, path)), { recursive: true });
    await writeFile(resolve(root, path), text);
  }
  return root;
}

test("finds the test files that profile their proxied requests", async () => {
  const root = await appWith({
    "src/shell/FolderVolume.test.tsx":
      "await measureWorkflowRequests({ label });",
    "src/mini-apps/UploadVolume.test.tsx":
      "profileProxiedApiRequests('upload', start);",
    "src/shell/Unrelated.test.tsx": "expect(true).toBe(true);",
    "src/shell/helper.ts": "profileProxiedApiRequests('not a test', 0);",
    "test/helpers/Budget.test.ts":
      "profileProxiedApiRequests('outside src', 0);",
  });
  expect(await discoverCanaries(root)).toEqual([
    { name: "FolderVolume", file: "src/shell/FolderVolume.test.tsx" },
    { name: "UploadVolume", file: "src/mini-apps/UploadVolume.test.tsx" },
  ]);
  expect(isCanarySource("import { profileProxiedApiRequests }")).toBe(false);
});

test("keeps canaries matching any filter and refuses an unmatched one", () => {
  const canaries = [
    { name: "GroupMutationRequestVolume", file: "a" },
    { name: "DualPaneProvider.groupsRequestVolume", file: "b" },
    { name: "ExplorerUploadRequestVolume", file: "c" },
  ];
  expect(selectCanaries(canaries, [])).toEqual(canaries);
  expect(
    selectCanaries(canaries, ["upload", "GroupMutation"]).map(
      (canary) => canary.file,
    ),
  ).toEqual(["a", "c"]);
  expect(selectCanaries(canaries, ["group"]).map((c) => c.file)).toEqual([
    "a",
    "b",
  ]);
  expect(() => selectCanaries(canaries, ["upload", "typo"])).toThrow(
    /No canary matches "typo"/,
  );
});

test("the app helpers still print the profile line discovery relies on", async () => {
  const helpers = resolve(appRoot, "test/helpers");
  const budget = await readFile(
    resolve(helpers, "proxiedApiRequestBudget.ts"),
    "utf8",
  );
  const workflow = await readFile(
    resolve(helpers, "workflowRequestBudget.ts"),
    "utf8",
  );
  expect(budget).toContain("export function profileProxiedApiRequests(");
  expect(budget).toContain("[dual-pane-request-metrics] ");
  expect(budget).toContain("[dual-pane-request-profile-detail] ");
  expect(budget).toContain('DUAL_PANE_REQUEST_PROFILE !== "1"');
  expect(workflow).toContain("export async function measureWorkflowRequests(");
  expect(workflow).toContain("profileProxiedApiRequests(input.label");
});

test("an app without canaries is an error, not an empty run", async () => {
  const root = await appWith({ "src/A.test.tsx": "expect(1).toBe(1);" });
  await expect(discoverCanaries(root)).rejects.toThrow(/No request-volume/);
});
