import { chmodSync, cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export async function runMacosRelease(args: string[], failure = "") {
  const root = mkdtempSync(join(tmpdir(), "tearleads-macos-release-"));
  const packageDir = join(root, "packages/app-electrobun");
  const log = join(root, "calls.log");
  async function write(path: string, source: string) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    await Bun.write(target, `${source}\n`);
    chmodSync(target, 0o755);
  }
  try {
    for (const name of ["releaseMacos.sh", "macosSigning.sh"]) {
      mkdirSync(join(packageDir, "scripts"), { recursive: true });
      cpSync(
        join(import.meta.dirname, name),
        join(packageDir, "scripts", name),
      );
    }
    await write("bin/git", '#!/bin/sh\nprintf "%s\\n" "$RELEASE_TEST_ROOT"');
    await write("bin/uname", '#!/bin/sh\necho "Darwin arm64"');
    await write(
      "bin/security",
      [
        "#!/bin/sh",
        '[ "$RELEASE_TEST_FAILURE" != signing ] || exit 7',
        "echo '1) hash \"Developer ID Application: Test (TEAM)\"'",
        "echo '2) hash \"Developer ID Application: Test (TEAM)\"'",
      ].join("\n"),
    );
    await write("key.p8", "test-only-key");
    await write(
      "terraform/scripts/common.sh",
      [
        'load_secrets_env() { printf "secrets %s\\n" "$1" >> "$RELEASE_TEST_LOG"; }',
        'validate_aws_env() { echo credentials >> "$RELEASE_TEST_LOG"; }',
      ].join("\n"),
    );
    await write(
      "bin/bunx",
      '#!/bin/sh\necho dependencies >> "$RELEASE_TEST_LOG"',
    );
    await write(
      "packages/app-electrobun/scripts/buildMacosIcon.sh",
      '#!/bin/sh\necho icons >> "$RELEASE_TEST_LOG"',
    );
    await write(
      "packages/app-electrobun/scripts/buildElectrobun.sh",
      [
        "#!/bin/sh",
        'printf "build %s %s %s %s\\n" "$*" "$ELECTROBUN_RELEASE_TIER" "$BUN_PUBLIC_API_BASE_URL" "$BUN_PUBLIC_WS_URL" >> "$RELEASE_TEST_LOG"',
        '[ "$RELEASE_TEST_FAILURE" != build ] || exit 6',
        'artifacts="$RELEASE_TEST_ROOT/packages/app-electrobun/build/artifacts"',
        'mkdir -p "$artifacts"',
        'if [ "$ELECTROBUN_RELEASE_TIER" = staging ]; then',
        "  channel=canary; app=Tearleads-canary; dmg=canary-macos-arm64-Tearleads-canary.dmg",
        "else",
        "  channel=stable; app=Tearleads; dmg=macos-arm64-Tearleads.dmg",
        "fi",
        'echo installer > "$artifacts/$dmg"',
        'echo metadata > "$artifacts/$channel-macos-arm64-update.json"',
        '[ "$RELEASE_TEST_FAILURE" = missing ] || echo archive > "$artifacts/$channel-macos-arm64-$app.app.tar.zst"',
      ].join("\n"),
    );
    await write(
      "bin/xcrun",
      [
        "#!/bin/sh",
        'echo stapler >> "$RELEASE_TEST_LOG"',
        '[ "$RELEASE_TEST_FAILURE" != notarization ] || exit 7',
      ].join("\n"),
    );
    await write(
      "bin/aws",
      [
        "#!/bin/sh",
        'printf "upload %s\\n" "$*" >> "$RELEASE_TEST_LOG"',
        '[ "$RELEASE_TEST_FAILURE" != payload ] || exit 8',
        'case "$3:$RELEASE_TEST_FAILURE" in *.sha256:checksum|*-update.json:metadata) exit 8 ;; esac',
      ].join("\n"),
    );
    const child = Bun.spawn(
      ["bash", join(packageDir, "scripts/releaseMacos.sh"), ...args],
      {
        env: {
          PATH: `${root}/bin:/usr/bin:/bin`,
          RELEASE_TEST_ROOT: root,
          RELEASE_TEST_LOG: log,
          RELEASE_TEST_FAILURE: failure,
          APP_STORE_CONNECT_KEY_ID: "test-key",
          APP_STORE_CONNECT_ISSUER_ID: "test-issuer",
          ELECTROBUN_APPLEAPIKEYPATH: join(root, "key.p8"),
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    const calls = (await Bun.file(log).exists())
      ? (await Bun.file(log).text()).trim().split("\n")
      : [];
    return { exitCode, stdout, stderr, calls };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
