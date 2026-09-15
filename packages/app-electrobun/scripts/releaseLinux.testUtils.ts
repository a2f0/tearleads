import { execFileSync } from "node:child_process";
import { chmod, cp, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export const bunLaunchVariables = [
  "BUN_OPTIONS",
  "BUN_INSPECT",
  "BUN_INSPECT_CONNECT_TO",
  "BUN_INSPECT_NOTIFY",
  "BUN_INSPECT_PRELOAD",
];

const releaseToken = "release-test-token";

// load_secrets_env exports every root.env name, the upload token included. No
// child, Docker's build arguments and context included, may carry the token, and
// none may inherit the Bun variables that add env files, preloads or a debugger.
const leakProbe = [
  `case "$SENTRY_AUTH_TOKEN $*" in *${releaseToken}*) echo token-leak >> "$RELEASE_TEST_LOG" ;; esac`,
  ...bunLaunchVariables.map(
    (name) =>
      `[ -z "\${${name}+x}" ] || echo "bun-launch ${name}" >> "$RELEASE_TEST_LOG"`,
  ),
].join("\n");

// The staged pairs the container leaves outside its app, under its dist. With
// "unstaged" there is nothing to copy, so docker cp fails; "partial" stages only
// the main pair.
const stagedMaps = [
  '[ "$RELEASE_TEST_FAILURE" != unstaged ] || exit 1',
  'dist="$RELEASE_TEST_TIER-app-linux-x64"',
  'mkdir -p "$3/$dist/bun"',
  "for file in bun/index.js bun/index.js.map chunk-a1.js chunk-a1.js.map; do",
  '  case "$RELEASE_TEST_FAILURE:$file" in partial:chunk-*) ;; *) echo "$file" > "$3/$dist/$file" ;; esac',
  "done",
].join("\n");

const dockerStub = [
  "#!/bin/sh",
  'printf "docker %s\\n" "$*" >> "$RELEASE_TEST_LOG"',
  leakProbe,
  'case "$1" in',
  "  info) exit 0 ;;",
  '  run) [ "$RELEASE_TEST_FAILURE" != smoke ] || exit 7 ;;',
  "  build)",
  '    tar -tzf - > "$RELEASE_TEST_ROOT/context.txt"',
  '    [ "$RELEASE_TEST_FAILURE" != build ] || exit 7',
  '    while [ "$1" != --iidfile ]; do shift; done',
  '    echo sha256:test-image > "$2" ;;',
  "  create) echo test-container ;;",
  '  cp) case "$2" in *sentry-sourcemaps*)',
  stagedMaps,
  "    exit 0 ;; esac",
  '    mkdir -p "$3"',
  '    if [ "$RELEASE_TEST_TIER" = staging ]; then',
  "      channel=canary; app=Tearleads-canary; prefix=canary-linux-x64",
  "    else channel=stable; app=Tearleads; prefix=linux-x64; fi",
  '    echo installer > "$3/$prefix-$app-Setup.tar.gz"',
  '    platform=linux; arch=x64; manifest_channel="$channel"',
  '    case "$RELEASE_TEST_FAILURE" in manifest-platform) platform=macos ;; manifest-arch) arch=arm64 ;; manifest-channel) manifest_channel=dev ;; esac',
  '    printf \'{"channel":"%s","platform":"%s","arch":"%s","artifact":{"file":"%s-linux-x64-%s.tar.zst"}}\' "$manifest_channel" "$platform" "$arch" "$channel" "$app" > "$3/$channel-linux-x64-update.json"',
  '    [ "$RELEASE_TEST_FAILURE" = missing ] || echo archive > "$3/$channel-linux-x64-$app.tar.zst"',
  // link-<suffix> swaps that artifact for a link to a host secret, as a hostile
  // container can: docker cp keeps the link.
  '    for file in "$3"/*; do case "$RELEASE_TEST_FAILURE:$file" in',
  "      link-Setup.tar.gz:*Setup.tar.gz | link-update.json:*update.json | link-tar.zst:*tar.zst)",
  '        rm "$file"; ln -s "$RELEASE_TEST_ROOT/.secrets/root.env" "$file" ;; esac; done ;;',
  '  rm) [ "$RELEASE_TEST_FAILURE" != cleanup ] || exit 7 ;;',
  "esac",
].join("\n");

// Stands in for the host upload: records its arguments, the staged files it was
// given and whether the commit is HEAD, and fails like a rejected upload.
const sourceMapUploadStub = `import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
const [tier, target, commit, directory] = process.argv.slice(2);
const log = (line) => appendFileSync(process.env.RELEASE_TEST_LOG, line + "\\n");
if (process.env.SENTRY_AUTH_TOKEN) log("token-leak");
const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const files = [...new Bun.Glob("**/*").scanSync({ cwd: directory, dot: true })].sort();
log(\`sourcemaps \${tier} \${target} \${commit === head ? "head" : commit} \${directory.startsWith(process.env.RELEASE_TEST_ROOT) ? "in-repo" : "outside"} \${files.join(",")}\`);
if (process.env.RELEASE_TEST_FAILURE === "sourcemap-upload" || files.length !== 4) process.exit(9);
`;

// Fixture Git calls run with no GIT_* variable, so none reaches the repository
// running these tests.
function fixtureGit(root: string, ...args: string[]) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
  );
  execFileSync("git", args, { cwd: root, env });
}

async function commitFixture(root: string) {
  fixtureGit(root, "init", "-q");
  fixtureGit(root, "add", ".");
  fixtureGit(
    root,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.test",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-qm",
    "fixture",
  );
}

async function readCalls(root: string, log: string) {
  const published: Record<string, string> = {};
  for (const file of await readdir(join(root, "published")))
    published[file] = await Bun.file(join(root, "published", file)).text();
  const artifacts = join(root, "packages/app-electrobun/build");
  const built = (await Bun.file(join(artifacts, ".")).exists())
    ? [...new Bun.Glob("**/*").scanSync({ cwd: artifacts, dot: true })]
    : [];
  return {
    published,
    built,
    calls: (await Bun.file(log).exists())
      ? (await Bun.file(log).text()).trim().split("\n")
      : [],
    context: (await Bun.file(join(root, "context.txt")).exists())
      ? await Bun.file(join(root, "context.txt")).text()
      : "",
  };
}

export async function runLinuxRelease(
  args: string[],
  failure = "",
  ambient: Record<string, string> = {},
) {
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
      "packages/app-electrobun/scripts/uploadLinuxSourceMaps.ts",
      sourceMapUploadStub,
    );
    await write(
      "terraform/scripts/common.sh",
      [
        `load_secrets_env() { echo "secrets $1" >> "$RELEASE_TEST_LOG"; export SENTRY_AUTH_TOKEN=${releaseToken}; }`,
        'validate_aws_env() { echo credentials >> "$RELEASE_TEST_LOG"; }',
      ].join("\n"),
    );
    await write(
      ".gitignore",
      ".secrets/\nnode_modules/\nlocal.env\npackages/app-electrobun/build/\nbin/\npublished/\ncalls.log\ncontext.txt",
    );
    await commitFixture(root);
    await write(".secrets/root.env", `SENTRY_AUTH_TOKEN=${releaseToken}`);
    await write("node_modules/host-only", "darwin dependencies");
    await write("local.env", "ignored-private-fixture");
    if (failure === "deleted") await rm(join(root, ".gitignore"));
    if (failure === "untracked") await write("bunfig.toml", "preload = []");
    if (failure === "dirty" || failure === "staged") {
      await Bun.write(
        join(root, ".gitignore"),
        ".secrets/\nnode_modules/\nlocal.env\npackages/app-electrobun/build/\nbin/\npublished/\ncalls.log\ncontext.txt\nchanged\n",
      );
      if (failure === "staged") fixtureGit(root, "add", ".gitignore");
    }
    await write(
      "bin/bun",
      `#!/bin/sh\nprintf "bun %s\\n" "$*" >> "$RELEASE_TEST_LOG"\n${leakProbe}\nexec '${process.execPath}' "$@"`,
    );
    await write("bin/docker", dockerStub);
    await write(
      "bin/aws",
      [
        "#!/bin/sh",
        'printf "upload %s\\n" "$*" >> "$RELEASE_TEST_LOG"',
        leakProbe,
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
          ...ambient,
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
    return {
      exitCode,
      stdout,
      stderr,
      discovery,
      ...(await readCalls(root, log)),
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

// Runs buildLinuxNative.sh as the container does, with its build tools stubbed,
// and returns the environment it gives buildElectrobun.sh.
export async function runLinuxNativeBuild(tier: string) {
  const root = await mkdtemp(join(tmpdir(), "tearleads-linux-native-"));
  const log = join(root, "build.log");
  async function write(path: string, source: string) {
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true });
    await Bun.write(target, `${source}\n`);
    await chmod(target, 0o755);
  }
  try {
    const scripts = join(root, "packages/app-electrobun/scripts");
    await mkdir(scripts, { recursive: true });
    await cp(
      join(import.meta.dirname, "buildLinuxNative.sh"),
      join(scripts, "buildLinuxNative.sh"),
    );
    await write("bin/uname", '#!/bin/sh\necho "Linux x86_64"');
    for (const tool of ["bunx", "rsvg-convert", "bun"])
      await write(`bin/${tool}`, "#!/bin/sh\nexit 0");
    await write(
      "packages/app-electrobun/scripts/buildElectrobun.sh",
      `#!/bin/sh\nprintf '%s|%s|%s\\n' "$ELECTROBUN_RELEASE_TIER" "$TEARLEADS_ELECTROBUN_SOURCEMAP_UPLOAD" "$*" > '${log}'`,
    );
    const child = Bun.spawn(
      ["bash", join(scripts, "buildLinuxNative.sh"), tier],
      {
        env: { PATH: `${root}/bin:/usr/bin:/bin` },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [exitCode, stderr] = await Promise.all([
      child.exited,
      new Response(child.stderr).text(),
    ]);
    const built = Bun.file(log);
    return {
      exitCode,
      stderr,
      build: (await built.exists()) ? (await built.text()).trim() : "",
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
