import { expect, test } from "bun:test";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "../../..");

// Join backslash continuations and drop comments, so each entry is one command.
function shellCommands(source: string) {
  return source
    .replace(/\\\n/g, " ")
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"));
}

async function xcodebuildCommands() {
  const commands: { path: string; command: string }[] = [];
  const glob = new Bun.Glob("scripts/**/*.sh");
  for await (const path of glob.scan({ cwd: repositoryRoot })) {
    if (path.startsWith("scripts/localstack/data/")) continue;
    const source = await Bun.file(resolve(repositoryRoot, path)).text();
    for (const command of shellCommands(source))
      if (/(^|[\s;&|(])xcodebuild(\s|$)/.test(command))
        commands.push({ path, command: command.trim() });
  }
  return commands;
}

test("every scripted xcodebuild builds only the committed Swift package pins", async () => {
  const commands = await xcodebuildCommands();
  expect(commands.map(({ path }) => path)).toEqual(
    expect.arrayContaining([
      "scripts/checks/testNativePurchaseBridge.sh",
      "scripts/runMaestroTests.sh",
      "scripts/takeSubscriptionReviewScreenshots.sh",
    ]),
  );
  for (const { path, command } of commands)
    expect(command, path).toContain("-disableAutomaticPackageResolution");
});
