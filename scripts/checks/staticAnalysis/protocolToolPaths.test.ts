import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, realpathSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fixture } from "./fixture.testUtils";

test("mise discovers protocol tools from the selected checkout", () => {
  const repo = fixture();
  try {
    const root = realpathSync(repo.cwd);
    const checksum = createHash("sha256").update("fixture").digest("hex");
    repo.write(
      ".mise.toml",
      'java = "temurin-25.1+0"\n"github:leanprover/lean4" = "4.1.0"\n',
    );
    repo.write("formal/lean/lean-toolchain", "leanprover/lean4:v4.1.0\n");
    repo.write(
      "scripts/checks/tlaToolsPin.sh",
      `TLA_TOOLS_JAR_SHA256_PIN=${checksum}\n`,
    );
    repo.write("toolchain/tla2tools.jar", "fixture");
    repo.write(
      "toolchain/bin/java",
      "#!/bin/sh\necho 'version \"25.1\"' >&2\n",
    );
    repo.write(
      "toolchain/bin/lake",
      '#!/bin/sh\necho "Lake (Lean version 4.1.0)"\n',
    );
    repo.write(
      "bin/mise",
      [
        "#!/bin/sh",
        "[ -f .mise.toml ] || exit 2",
        'case "$1 $2" in',
        '  "which java") echo "$PWD/toolchain/bin/java" ;;',
        '  "where github:tlaplus/tlaplus" | "where github:leanprover/lean4") echo "$PWD/toolchain" ;;',
        "  *) exit 1 ;;",
        "esac",
      ].join("\n"),
    );
    for (const file of ["bin/mise", "toolchain/bin/java", "toolchain/bin/lake"])
      chmodSync(join(root, file), 0o755);
    const protocol = resolve(import.meta.dir, "../../protocol");
    const child = Bun.spawnSync(
      [
        process.execPath,
        "--eval",
        `
      import { resolveLeanTools } from ${JSON.stringify(join(protocol, "leanTools.ts"))};
      import { resolveTlcTools } from ${JSON.stringify(join(protocol, "tlcTools.ts"))};
      const root = ${JSON.stringify(root)};
      console.log(JSON.stringify([resolveLeanTools(root).lake, resolveTlcTools(root).javaBin]));
    `,
      ],
      {
        cwd: join(root, ".."),
        env: { PATH: join(root, "bin") },
      },
    );
    expect(child.exitCode, child.stderr.toString()).toBe(0);
    expect(JSON.parse(child.stdout.toString())).toEqual([
      join(root, "toolchain/bin/lake"),
      join(root, "toolchain/bin/java"),
    ]);
  } finally {
    rmSync(repo.cwd, { recursive: true, force: true });
  }
});
