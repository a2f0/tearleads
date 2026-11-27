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
  expect(budget).toContain('DUAL_PANE_REQUEST_PROFILE !== "1"');
  // The repeated-paths block parseCanaryOutput reads: a heading with the
  // phase label, then one `count METHOD path` line per repeated path, or a
  // placeholder line when none repeated.
  expect(budget).toMatch(
    /`\[dual-pane-request-profile-detail\] \$\{label\} repeated-paths\\n\$\{summarizeRepeatedProxiedApiRequestPaths\(requests\)\}`/u,
  );
  expect(budget).toMatch(
    /const key = `\$\{request\.method\} \$\{shortRequestPathIds\(requestPathAndQuery\(request\.url\)\)\}`;/u,
  );
  expect(budget).toMatch(
    /\.map\(\(\[key, count\]\) => `\$\{count\.toString\(\)\.padStart\(3, " "\)\} \$\{key\}`\)/u,
  );
  expect(budget).toContain('return "(no repeated exact paths)";');
  expect(workflow).toContain("export async function measureWorkflowRequests(");
  expect(workflow).toContain("profileProxiedApiRequests(input.label");
});

test("refuses two canaries with one file name", async () => {
  const root = await appWith({
    "src/shell/Volume.test.tsx": "profileProxiedApiRequests('a', 0);",
    "src/mini-apps/Volume.test.tsx": "profileProxiedApiRequests('b', 0);",
    "src/mini-apps/Other.test.tsx": "profileProxiedApiRequests('c', 0);",
  });
  await expect(discoverCanaries(root)).rejects.toThrow(
    "each needs its own file name: Volume (src/mini-apps/Volume.test.tsx, src/shell/Volume.test.tsx).",
  );
});

test("an app without canaries is an error, not an empty run", async () => {
  const root = await appWith({ "src/A.test.tsx": "expect(1).toBe(1);" });
  await expect(discoverCanaries(root)).rejects.toThrow(/No request-volume/);
});
