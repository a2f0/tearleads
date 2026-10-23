import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fixture } from "./fixture.testUtils";

const root = resolve(import.meta.dir, "../../..");
type Repository = ReturnType<typeof fixture>;

function policy(repo: Repository, overrides = {}) {
  const config = JSON.parse(
    readFileSync(join(root, "agent-tool.json"), "utf8"),
  );
  config.commits = { ...config.commits, ...overrides };
  repo.write("agent-tool.json", JSON.stringify(config));
}

function check(repo: Repository, ...args: string[]) {
  return Bun.spawnSync(
    [
      process.execPath,
      join(root, "node_modules/.bin/agent-tool"),
      "commits",
      "check",
      ...args,
    ],
    { cwd: repo.cwd, env: repo.env, stdout: "pipe", stderr: "pipe" },
  );
}

// Test-only keys remain inside the fixture's .git directory and are never
// staged, printed, or used outside this fixture.
function signedCommit(repo: Repository, message: string) {
  const key = join(repo.cwd, ".git/test-signing-key");
  const generated = Bun.spawnSync(
    ["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", key],
    {
      cwd: repo.cwd,
      env: repo.env,
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  expect(generated.exitCode, generated.stderr.toString()).toBe(0);
  repo.write(
    ".git/allowed_signers",
    `fixture@example.invalid ${readFileSync(`${key}.pub`, "utf8")}`,
  );
  repo.git("config", "gpg.format", "ssh");
  repo.git(
    "config",
    "gpg.ssh.allowedSignersFile",
    join(repo.cwd, ".git/allowed_signers"),
  );
  repo.git("config", "user.signingkey", key);
  repo.write("signed.txt", "signed content\n");
  repo.git("add", "signed.txt");
  repo.git("-c", "commit.gpgsign=true", "commit", "-qm", message);
  expect(
    repo.git(
      "show",
      "--no-show-signature",
      "--no-patch",
      "--format=%G?",
      "HEAD",
    ),
  ).toBe("G");
}

test("trust checks exclude accepted remote commits but reject new unsigned commits", () => {
  const repo = fixture();
  try {
    policy(repo);
    const oldRemote = repo.commit();
    repo.git("remote", "add", "origin", "https://example.invalid/fixture.git");
    repo.git("update-ref", "refs/remotes/origin/chore/probe", oldRemote);
    repo.write("incoming.txt", "already accepted on main\n");
    const incoming = repo.commit();
    repo.git("update-ref", "refs/remotes/origin/main", incoming);
    expect(check(repo, "--range", `${oldRemote}..HEAD`).exitCode).toBe(1);
    expect(
      check(
        repo,
        "--range",
        "HEAD",
        "--exclude",
        oldRemote,
        "--exclude-remotes",
        "origin",
      ).exitCode,
    ).toBe(0);
    repo.write("local.txt", "new unsigned commit must fail\n");
    repo.commit();
    expect(
      check(
        repo,
        "--range",
        "HEAD",
        "--exclude",
        oldRemote,
        "--exclude-remotes",
        "origin",
      ).exitCode,
    ).toBe(1);
  } finally {
    rmSync(repo.cwd, { recursive: true, force: true });
  }
});

test("a valid signature does not excuse a coauthor trailer", () => {
  const repo = fixture();
  try {
    policy(repo);
    repo.commit();
    signedCommit(
      repo,
      "chore: signed change\n\nCo-authored-by: Fixture <fixture@example.invalid>",
    );
    const result = check(repo, "--range", "HEAD^..HEAD");
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout.toString()).findings[0].errors).toEqual([
      "Co-authored-by trailer is forbidden.",
    ]);
    // Negative control: disabling this exact policy makes the rejected input pass.
    policy(repo, { rejectCoauthors: false });
    expect(check(repo, "--range", "HEAD^..HEAD").exitCode).toBe(0);
  } finally {
    rmSync(repo.cwd, { recursive: true, force: true });
  }
});

test("signature presence rejects an invalid signature, not only missing signatures", () => {
  const repo = fixture();
  try {
    policy(repo);
    repo.commit();
    signedCommit(repo, "chore: signed change");
    expect(check(repo, "--range", "HEAD^..HEAD").exitCode).toBe(0);
    const altered = `${repo.git("cat-file", "commit", "HEAD").replace("chore: signed change", "chore: altered change")}\n`;
    const written = Bun.spawnSync(
      ["git", "hash-object", "-t", "commit", "-w", "--stdin"],
      {
        cwd: repo.cwd,
        env: repo.env,
        stdin: Buffer.from(altered),
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    expect(written.exitCode, written.stderr.toString()).toBe(0);
    const corrupt = written.stdout.toString().trim();
    expect(
      repo.git(
        "show",
        "--no-show-signature",
        "--no-patch",
        "--format=%G?",
        corrupt,
      ),
    ).toBe("B");
    const result = check(repo, "--range", `HEAD^..${corrupt}`);
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout.toString()).findings[0].errors).toEqual([
      "Signature does not meet 'present' policy (B).",
    ]);
    policy(repo, { signatures: "none" });
    expect(check(repo, "--range", `HEAD^..${corrupt}`).exitCode).toBe(0);
  } finally {
    rmSync(repo.cwd, { recursive: true, force: true });
  }
});
