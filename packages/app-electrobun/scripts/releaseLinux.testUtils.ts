import { execFileSync } from "node:child_process";
import { chmod, cp, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export async function runLinuxRelease(args: string[], failure = "") {
  const { PATH: inheritedPath } = process.env;
  const root = await mkdtemp(join(tmpdir(), "tearleads-linux-release-"));
  const log = join(root, "calls.log");
  async function write(path: string, source: string) {
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true });
    await Bun.write(target, `${source}\n`);
    await chmod(target, 0o755);
  }
  try {
    const scripts = join(root, "packages/app-electrobun/scripts");
    await mkdir(scripts, { recursive: true });
    for (const name of [
      "releaseLinux.sh",
      "publishLinuxRelease.ts",
      "publishDesktopRelease.ts",
    ])
      await cp(join(import.meta.dirname, name), join(scripts, name));
    await write(
      "terraform/scripts/common.sh",
      [
        'load_secrets_env() { echo "secrets $1" >> "$RELEASE_TEST_LOG"; }',
        'validate_aws_env() { echo credentials >> "$RELEASE_TEST_LOG"; }',
      ].join("\n"),
    );
    await write(".gitignore", ".secrets/\nnode_modules/");
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.test",
        "-c",
        "commit.gpgsign=false",
        "commit",
        "-qm",
        "fixture",
      ],
      { cwd: root },
    );
    await write(".secrets/root.env", "PRIVATE_FIXTURE=must-not-enter-docker");
    await write("node_modules/host-only", "darwin dependencies");
    await write("untracked.env", "untracked-private-fixture");
    if (failure === "deleted") await rm(join(root, ".gitignore"));
    if (failure === "dirty" || failure === "staged") {
      await Bun.write(
        join(root, ".gitignore"),
        ".secrets/\nnode_modules/\nchanged\n",
      );
      if (failure === "staged")
        execFileSync("git", ["add", ".gitignore"], { cwd: root });
    }
    await write("bin/bun", `#!/bin/sh\nexec '${process.execPath}' "$@"`);
    await write(
      "bin/docker",
      [
        "#!/bin/sh",
        'printf "docker %s\\n" "$*" >> "$RELEASE_TEST_LOG"',
        'case "$1" in',
        "  info) exit 0 ;;",
        '  run) [ "$RELEASE_TEST_FAILURE" != smoke ] || exit 7 ;;',
        "  build)",
        '    tar -tzf - > "$RELEASE_TEST_ROOT/context.txt"',
        '    [ "$RELEASE_TEST_FAILURE" != build ] || exit 7',
        '    while [ "$1" != --iidfile ]; do shift; done',
        '    echo sha256:test-image > "$2" ;;',
        "  create) echo test-container ;;",
        "  cp)",
        '    mkdir -p "$3"',
        '    if [ "$RELEASE_TEST_TIER" = staging ]; then',
        "      channel=canary; app=Tearleads-canary; prefix=canary-linux-x64",
        "    else channel=stable; app=Tearleads; prefix=linux-x64; fi",
        '    echo installer > "$3/$prefix-$app-Setup.tar.gz"',
        '    platform=linux; arch=x64; manifest_channel="$channel"',
        '    case "$RELEASE_TEST_FAILURE" in manifest-platform) platform=macos ;; manifest-arch) arch=arm64 ;; manifest-channel) manifest_channel=dev ;; esac',
        '    printf \'{"channel":"%s","platform":"%s","arch":"%s","artifact":{"file":"%s-linux-x64-%s.tar.zst"}}\' "$manifest_channel" "$platform" "$arch" "$channel" "$app" > "$3/$channel-linux-x64-update.json"',
        '    [ "$RELEASE_TEST_FAILURE" = missing ] || echo archive > "$3/$channel-linux-x64-$app.tar.zst" ;;',
        '  rm) [ "$RELEASE_TEST_FAILURE" != cleanup ] || exit 7 ;;',
        "esac",
      ].join("\n"),
    );
    await write(
      "bin/aws",
      [
        "#!/bin/sh",
        'printf "upload %s\\n" "$*" >> "$RELEASE_TEST_LOG"',
        'case "$3:$RELEASE_TEST_FAILURE" in *Setup.tar.gz:payload|*.sha256:checksum|*-update.json:metadata) exit 8 ;; esac',
        'cp "$3" "$RELEASE_TEST_ROOT/published/$(basename "$4")"',
      ].join("\n"),
    );
    const channel = args[1] === "staging" ? "canary" : "stable";
    const discovery = `${channel}-linux-x64-download.json`;
    await write(`published/${discovery}`, "previous discovery");
    await write("published/previous-Setup.tar.gz", "previous installer");
    const child = Bun.spawn(
      ["bash", join(scripts, "releaseLinux.sh"), ...args],
      {
        cwd: root,
        env: {
          PATH: `${root}/bin:${inheritedPath}`,
          RELEASE_TEST_ROOT: root,
          RELEASE_TEST_LOG: log,
          RELEASE_TEST_FAILURE: failure,
          RELEASE_TEST_TIER: args[1],
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
    const published: Record<string, string> = {};
    for (const file of await readdir(join(root, "published")))
      published[file] = await Bun.file(join(root, "published", file)).text();
    return {
      exitCode,
      stdout,
      stderr,
      published,
      discovery,
      calls: (await Bun.file(log).exists())
        ? (await Bun.file(log).text()).trim().split("\n")
        : [],
      context: (await Bun.file(join(root, "context.txt")).exists())
        ? await Bun.file(join(root, "context.txt")).text()
        : "",
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
