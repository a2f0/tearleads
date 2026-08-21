import { describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "../../..");
const authorizationPath = resolve(
  repositoryRoot,
  "scripts/keychain/authorizeCodesignPartitionList.sh",
);
const targetKeychain = "/tmp/test-login.keychain-db";

async function runAuthorization(
  environment: Record<string, string>,
  argumentsList: string[] = [],
) {
  const child = Bun.spawn(["sh", authorizationPath, ...argumentsList], {
    env: {
      ...process.env,
      CODESIGN_LOGIN_KEYCHAIN: targetKeychain,
      ...environment,
    },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stderr, stdout] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
    new Response(child.stdout).text(),
  ]);
  return { exitCode, stderr, stdout };
}

async function writeExecutable(path: string, source: string) {
  await Bun.write(path, source);
  await chmod(path, 0o700);
}

describe("codesign keychain authorization", () => {
  test("skips the password prompt when the probe succeeds", async () => {
    const result = await runAuthorization({
      CODESIGN_COMMAND: "/usr/bin/true",
      CODESIGN_PROBE_IDENTITY: "TESTIDENTITY",
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain("no password prompt needed");
    expect(result.stdout).not.toContain("keychain password");
  });

  test("fails without prompting in a noninteractive shell", async () => {
    const result = await runAuthorization({
      CODESIGN_COMMAND: "/usr/bin/false",
      CODESIGN_PROBE_IDENTITY: "TESTIDENTITY",
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("requires interactive authorization");
  });

  test("uses a known empty temporary-keychain password", async () => {
    const result = await runAuthorization({
      CODESIGN_COMMAND: "/usr/bin/false",
      CODESIGN_KEYCHAIN_PASSWORD: "",
      CODESIGN_PROBE_IDENTITY: "TESTIDENTITY",
      CODESIGN_SECURITY_COMMAND: "/usr/bin/true",
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("Authorizing codesign");
    expect(result.stderr).toContain(
      "still cannot use the required signing key",
    );
    expect(result.stderr).not.toContain("requires interactive authorization");
  });

  test("discovers identities only in the target keychain", async () => {
    const temporaryDirectory = await mkdtemp(
      join(tmpdir(), "symcrypt-security-"),
    );
    const commandPath = join(temporaryDirectory, "security");
    const logPath = join(temporaryDirectory, "arguments.log");
    await writeExecutable(
      commandPath,
      '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$CODESIGN_SECURITY_LOG"\nprintf \'  1) TESTIDENTITY "Apple Distribution: Test (TEAM)"\\n\'\n',
    );

    try {
      const result = await runAuthorization({
        CODESIGN_COMMAND: "/usr/bin/true",
        CODESIGN_SECURITY_COMMAND: commandPath,
        CODESIGN_SECURITY_LOG: logPath,
      });
      expect(result.exitCode, result.stderr).toBe(0);
      expect(await Bun.file(logPath).text()).toBe(
        `find-identity -v -p codesigning ${targetKeychain}\n`,
      );
    } finally {
      await rm(temporaryDirectory, { force: true, recursive: true });
    }
  });

  test("pins the codesign probe to the target keychain", async () => {
    const temporaryDirectory = await mkdtemp(
      join(tmpdir(), "symcrypt-codesign-"),
    );
    const commandPath = join(temporaryDirectory, "codesign");
    const logPath = join(temporaryDirectory, "arguments.log");
    await writeExecutable(
      commandPath,
      '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$CODESIGN_COMMAND_LOG"\n',
    );

    try {
      const result = await runAuthorization({
        CODESIGN_COMMAND: commandPath,
        CODESIGN_COMMAND_LOG: logPath,
        CODESIGN_PROBE_IDENTITY: "TESTIDENTITY",
      });
      expect(result.exitCode, result.stderr).toBe(0);
      expect(await Bun.file(logPath).text()).toStartWith(
        `--keychain ${targetKeychain} --force --sign TESTIDENTITY `,
      );
    } finally {
      await rm(temporaryDirectory, { force: true, recursive: true });
    }
  });

  test("rejects malformed profile certificate data before authorization", async () => {
    const temporaryDirectory = await mkdtemp(
      join(tmpdir(), "symcrypt-profile-"),
    );
    const commandPath = join(temporaryDirectory, "security");
    const profilePath = join(temporaryDirectory, "malformed.mobileprovision");
    await Bun.write(profilePath, "profile fixture");
    await writeExecutable(
      commandPath,
      '#!/bin/sh\ncat <<\'EOF\'\n<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>DeveloperCertificates</key><array><data>bm90LWEtY2VydGlmaWNhdGU=</data></array></dict></plist>\nEOF\n',
    );

    try {
      const result = await runAuthorization(
        {
          CODESIGN_COMMAND: "/usr/bin/false",
          CODESIGN_KEYCHAIN_PASSWORD: "",
          CODESIGN_SECURITY_COMMAND: commandPath,
        },
        [profilePath],
      );
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("does not contain a valid SHA-1");
      expect(result.stdout).not.toContain("Authorizing codesign");
    } finally {
      await rm(temporaryDirectory, { force: true, recursive: true });
    }
  });
});
