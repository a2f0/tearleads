import { afterEach, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const library = join(import.meta.dir, "gradleWrapper.sh");

// Records its arguments and, for the wrapper task, writes a jar into the
// project directory it was given, failing when STUB_FAIL is set or the
// directory has no settings file (Gradle 9 refuses to run without one).
const GRADLE_STUB = `#!/bin/sh
printf '%s\\n' "$*" >> "$STUB_LOG"
[ -z "\${STUB_FAIL:-}" ] || exit 3
while [ "$#" -gt 0 ]; do
  case "$1" in
    exec | --) ;;
    --project-dir) project="$2"; shift ;;
  esac
  shift
done
[ -f "$project/settings.gradle" ] || exit 4
mkdir -p "$project/gradle/wrapper"
printf 'jar from %s\\n' "\${STUB_NAME}" > "$project/gradle/wrapper/gradle-wrapper.jar"
`;

const temporary: string[] = [];
afterEach(() => {
  for (const directory of temporary.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

interface Fixture {
  readonly android: string;
  readonly jar: string;
  readonly bin: string;
  readonly scratch: string;
  readonly log: string;
}

/**
 * An Android project with its tracked wrapper files, a PATH holding only the
 * tools the helper uses, and a private TMPDIR so leftover scratch builds show.
 */
function fixture(): Fixture {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "gradle-wrapper-")));
  temporary.push(root);
  const android = join(root, "android");
  mkdirSync(join(android, "gradle/wrapper"), { recursive: true });
  writeFileSync(join(android, "gradlew"), "tracked gradlew\n");
  writeFileSync(
    join(android, "gradle/wrapper/gradle-wrapper.properties"),
    "tracked properties\n",
  );
  const bin = join(root, "bin");
  mkdirSync(bin);
  for (const tool of ["cp", "mkdir", "mktemp", "mv", "rm"]) {
    const path = Bun.which(tool);
    if (!path) throw new Error(`${tool} is not on PATH`);
    symlinkSync(path, join(bin, tool));
  }
  const scratch = join(root, "tmp");
  mkdirSync(scratch);
  return {
    android,
    jar: join(android, "gradle/wrapper/gradle-wrapper.jar"),
    bin,
    scratch,
    log: join(root, "stub.log"),
  };
}

function installStub({ bin }: Fixture, name: "gradle" | "mise"): void {
  writeFileSync(join(bin, name), GRADLE_STUB);
  chmodSync(join(bin, name), 0o755);
}

function ensure(setup: Fixture, env: Record<string, string> = {}) {
  const result = Bun.spawnSync({
    cmd: [
      "/bin/sh",
      "-c",
      `set -e\n. "${library}"\nensure_gradle_wrapper_jar "$1"`,
      "sh",
      setup.android,
    ],
    env: {
      PATH: setup.bin,
      TMPDIR: setup.scratch,
      STUB_LOG: setup.log,
      ...env,
    },
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

function stubCalls({ log }: Fixture): string[] {
  return existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : [];
}

function expectTrackedFilesUntouched({ android }: Fixture): void {
  expect(readFileSync(join(android, "gradlew"), "utf8")).toBe(
    "tracked gradlew\n",
  );
  expect(
    readFileSync(
      join(android, "gradle/wrapper/gradle-wrapper.properties"),
      "utf8",
    ),
  ).toBe("tracked properties\n");
}

test("an existing jar runs no Gradle", () => {
  const setup = fixture();
  installStub(setup, "gradle");
  writeFileSync(setup.jar, "existing jar\n");

  expect(ensure(setup)).toEqual({ exitCode: 0, stdout: "", stderr: "" });
  expect(stubCalls(setup)).toEqual([]);
  expect(readFileSync(setup.jar, "utf8")).toBe("existing jar\n");
});

test("a missing jar comes from a scratch build, leaving tracked files alone", () => {
  const setup = fixture();
  installStub(setup, "gradle");

  const result = ensure(setup, { STUB_NAME: "gradle" });
  expect(result.exitCode, result.stderr).toBe(0);
  expect(readFileSync(setup.jar, "utf8")).toBe("jar from gradle\n");
  const [call, ...rest] = stubCalls(setup);
  expect(rest).toEqual([]);
  expect(call).toMatch(
    /^--quiet --project-dir \S+ wrapper --distribution-type all$/,
  );
  expect(call).not.toContain(setup.android);
  expect(call).toContain(setup.scratch);
  expectTrackedFilesUntouched(setup);
  expect(readdirSync(setup.scratch)).toEqual([]);
});

test("mise provides Gradle when it is not on PATH", () => {
  const setup = fixture();
  installStub(setup, "mise");

  const result = ensure(setup, { STUB_NAME: "mise" });
  expect(result.exitCode, result.stderr).toBe(0);
  expect(readFileSync(setup.jar, "utf8")).toBe("jar from mise\n");
  expect(stubCalls(setup)[0]).toStartWith(
    "exec -- gradle --quiet --project-dir ",
  );
});

test("a failed wrapper task fails the caller and leaves no partial jar", () => {
  const setup = fixture();
  installStub(setup, "gradle");

  const result = ensure(setup, { STUB_FAIL: "1" });
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("could not generate");
  expect(existsSync(setup.jar)).toBe(false);
  expect(readdirSync(join(setup.android, "gradle/wrapper"))).toEqual([
    "gradle-wrapper.properties",
  ]);
  expectTrackedFilesUntouched(setup);
  expect(readdirSync(setup.scratch)).toEqual([]);
});

test("without Gradle or mise it fails with the setup hint", () => {
  const setup = fixture();

  const result = ensure(setup);
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("Run `mise install` from the repo root.");
  expect(existsSync(setup.jar)).toBe(false);
});
