import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Runs the script with stub `bun`, `security`, and `uname` first on PATH, so
// nothing is installed, unlocked, or signed in to; the stubs print the
// commands the script would have run.
const script = join(import.meta.dir, "restoreKeepass.sh");
let root = "";
let caller = "";

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "restore-keepass-script-")));
  const bin = join(root, "bin");
  caller = join(root, "my files");
  mkdirSync(bin);
  mkdirSync(caller);
  const stubs = {
    bun: `printf 'bun'; for a in "$@"; do printf ' [%s]' "$a"; done; echo`,
    security: `echo "security $*"`,
    // runOn always sets UNAME_STUB.
    uname: 'echo "$UNAME_STUB"',
  };
  for (const [name, body] of Object.entries(stubs)) {
    writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  }
  writeFileSync(join(caller, "My Vault.kdbx"), "");
  writeFileSync(join(caller, "vault.keyx"), "");
});

afterAll(() => rmSync(root, { force: true, recursive: true }));

function runOn(platform: string, args: readonly string[]) {
  const { PATH = "", PWD: _inherited, ...env } = process.env;
  const result = Bun.spawnSync(["sh", script, ...args], {
    cwd: caller,
    env: {
      ...env,
      PATH: `${join(root, "bin")}:${PATH}`,
      UNAME_STUB: platform,
    },
    stderr: "pipe",
    stdout: "pipe",
  });
  return {
    code: result.exitCode,
    stderr: result.stderr.toString(),
    stdout: result.stdout.toString().trim().split("\n"),
  };
}

const run = (...args: string[]) => runOn("Darwin", args);

const setup = (env: string) => [
  "security unlock-keychain",
  "bun [install]",
  "bun [run] [build:runtime]",
  `bun [run] [tearleads] [login] [--env] [${env}]`,
];

describe("restoreKeepass.sh", () => {
  test("logs in, then restores traced with paths from the caller's directory", () => {
    const { code, stdout } = run(
      "staging",
      "My Vault.kdbx",
      "--name",
      "Family Vault",
      "--key-file",
      "vault.keyx",
    );
    expect(code).toBe(0);
    expect(stdout).toEqual([
      ...setup("staging"),
      `bun [run] [tearleads] [restore-keepass] [${caller}/My Vault.kdbx] [--env] [staging] [--trace] [--name=Family Vault] [--key-file] [${caller}/vault.keyx]`,
    ]);
  });

  test("keeps absolute paths, takes --flag=value forms, and maps each tier", () => {
    const { code, stdout } = run(
      "prod",
      join(caller, "My Vault.kdbx"),
      "--name=Vault",
      "--key-file=vault.keyx",
    );
    expect(code).toBe(0);
    expect(stdout.at(-1)).toBe(
      `bun [run] [tearleads] [restore-keepass] [${caller}/My Vault.kdbx] [--env] [production] [--trace] [--name=Vault] [--key-file=${caller}/vault.keyx]`,
    );
    expect(run("dev", "My Vault.kdbx").stdout).toEqual([
      ...setup("development"),
      `bun [run] [tearleads] [restore-keepass] [${caller}/My Vault.kdbx] [--env] [development] [--trace]`,
    ]);
  });

  test("passes a --name value inline, so one starting with - stays a name", () => {
    const { code, stdout } = run("staging", "My Vault.kdbx", "--name", "-old");
    expect(code).toBe(0);
    expect(stdout.at(-1)).toEndWith("[--trace] [--name=-old]");
  });

  test("skips the Keychain unlock off macOS", () => {
    const { code, stdout } = runOn("Linux", ["staging", "My Vault.kdbx"]);
    expect(code).toBe(0);
    expect(stdout.slice(0, 2)).toEqual([
      "Not macOS; skipping the login Keychain unlock.",
      "bun [install]",
    ]);
  });

  test.each([
    [["qa", "My Vault.kdbx"], "Usage: scripts/dev/restoreKeepass.sh"],
    [["staging"], "Usage: scripts/dev/restoreKeepass.sh"],
    [["staging", "missing.kdbx"], "Cannot read"],
    [["staging", "My Vault.kdbx", "--key-file"], "--key-file needs a value."],
    [["staging", "My Vault.kdbx", "--name"], "--name needs a value."],
    [["staging", "My Vault.kdbx", "--key-file", "nope.keyx"], "Cannot read"],
    [["staging", "My Vault.kdbx", "--key-file=nope.keyx"], "Cannot read"],
    [["staging", "My Vault.kdbx", "--env", "prod"], "--env does not apply"],
    [["staging", "My Vault.kdbx", "--env=prod"], "--env=prod does not apply"],
    [
      ["staging", "My Vault.kdbx", "--api-url", "http://127.0.0.1:1"],
      "--api-url does not apply",
    ],
    [["staging", "My Vault.kdbx", "--key-stdin"], "--key-stdin does not apply"],
    [["staging", "My Vault.kdbx", "--nmae", "Vault"], "Unknown option --nmae"],
    [["staging", "My Vault.kdbx", "extra"], "Unknown option extra"],
  ])(
    "refuses %j before unlocking, building, or logging in",
    (args, message) => {
      const { code, stderr, stdout } = run(...args);
      expect(code).toBe(1);
      expect(stderr).toContain(message);
      expect(stdout).toEqual([""]);
    },
  );

  test("--help prints the usage", () => {
    const { code, stdout } = run("--help");
    expect(code).toBe(0);
    expect(stdout[0]).toStartWith("Usage: scripts/dev/restoreKeepass.sh");
  });
});
