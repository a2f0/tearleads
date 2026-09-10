import { expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fixture } from "./fixture.testUtils";

test("tracked inventory covers nested scripts and shell shebangs with explicit exceptions", () => {
  const repo = fixture();
  try {
    for (const [path, source] of Object.entries({
      "new/nested/scripts/check.sh": 'printf "ok\\n"\n',
      "scripts/git/hooks/pre-push": '#!/bin/sh\nprintf "ok\\n"\n',
      "tools/script with spaces":
        '#!/usr/bin/env -S bash -eu\nprintf "ok\\n"\n',
      "tools/node": '#!/usr/bin/env node\nconsole.log("ok");\n',
      "tools/plain": "plain text\n",
      "missing.md": "gone\n",
      "missing.sh": "#!/bin/sh\n",
      directory: "replaced\n",
      "packages/app-capacitor/android/gradlew": "#!/bin/sh\nupstream\n",
      "ansible/playbooks/templates/usr/local/bin/tearleads-api-cli.j2":
        "#!/bin/sh\n{{ template }}\n",
    }))
      repo.write(path, source);
    repo.git("add", ".");
    repo.write("untracked.sh", "#!/bin/sh\n");
    for (const path of ["missing.md", "missing.sh", "directory"])
      rmSync(join(repo.cwd, path));
    mkdirSync(join(repo.cwd, "directory"));
    const modulePath = resolve(import.meta.dir, "../shellScripts.ts");
    const inventory = Bun.spawnSync(
      [
        process.execPath,
        "--eval",
        `import { shellScriptInventory } from ${JSON.stringify(modulePath)}; console.log(JSON.stringify(shellScriptInventory(process.cwd()).files));`,
      ],
      { cwd: repo.cwd, env: repo.env, stdout: "pipe", stderr: "pipe" },
    );
    expect(inventory.exitCode, inventory.stderr.toString()).toBe(0);
    expect(JSON.parse(inventory.stdout.toString())).toEqual([
      "new/nested/scripts/check.sh",
      "scripts/git/hooks/pre-push",
      "tools/script with spaces",
    ]);
  } finally {
    rmSync(repo.cwd, { recursive: true, force: true });
  }
});

test.each([".", "nested"])(
  "the lint command discovers root hooks from %s and propagates failures",
  (subdirectory) => {
    const repo = fixture();
    try {
      repo.write("hooks/pre-push", "#!/bin/sh\necho $unquoted\n");
      repo.git("add", ".");
      const cwd = join(repo.cwd, subdirectory);
      mkdirSync(cwd, { recursive: true });
      const result = Bun.spawnSync(
        [process.execPath, resolve(import.meta.dir, "../../lintScripts.ts")],
        { cwd, env: repo.env, stdout: "pipe", stderr: "pipe" },
      );
      expect(result.exitCode).toBe(1);
      expect(result.stdout.toString()).toContain("SC2086");
    } finally {
      rmSync(repo.cwd, { recursive: true, force: true });
    }
  },
);
