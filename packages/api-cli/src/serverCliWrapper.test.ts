import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// The operator wrapper ansible installs at /usr/local/bin/tearleads-api-cli.
// It hardcodes the env file and CLI paths, so the test renders the template
// and points those two constants at fixtures under a temp directory.
const templatePath = fileURLToPath(
  new URL(
    "../../../ansible/playbooks/templates/usr/local/bin/tearleads-api-cli.j2",
    import.meta.url,
  ),
);

let fixtureDir: string;
let wrapperPath: string;
let envFilePath: string;
let migrationEnvFilePath: string;
let cliPath: string;
let cliRanMarker: string;

async function runWrapper(
  args: readonly string[],
): Promise<{ exitCode: number; stderr: string; stdout: string }> {
  const { PATH = "" } = process.env;
  const proc = Bun.spawn(["sh", wrapperPath, ...args], {
    env: { PATH },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stderr, stdout };
}

async function installFakeCli(): Promise<void> {
  await writeFile(
    cliPath,
    [
      "#!/bin/sh",
      `touch "${cliRanMarker}"`,
      'printf "env:%s|%s\\n" "$API_DATABASE" "$QUOTED_SECRET"',
      'for arg in "$@"; do printf "arg:%s\\n" "$arg"; done',
      'exit "$FAKE_CLI_EXIT"',
      "",
    ].join("\n"),
  );
  await chmod(cliPath, 0o755);
}

beforeAll(async () => {
  fixtureDir = await mkdtemp(join(tmpdir(), "tearleads-cli-wrapper-"));
  wrapperPath = join(fixtureDir, "tearleads-api-cli");
  envFilePath = join(fixtureDir, "api.env");
  migrationEnvFilePath = join(fixtureDir, "migrations.env");
  cliPath = join(fixtureDir, "real-cli");
  cliRanMarker = join(fixtureDir, "cli-ran");

  const template = await readFile(templatePath, "utf8");
  const rendered = template
    .replace("{{ ansible_managed }}", "test render")
    .replace("env_file=/etc/tearleads/api.env", `env_file=${envFilePath}`)
    .replace(
      "env_file=/etc/tearleads/migrations.env",
      `env_file=${migrationEnvFilePath}`,
    )
    .replace("cli=/opt/tearleads/bin/tearleads-api-cli", `cli=${cliPath}`);
  expect(rendered).toContain(`\nenv_file=${envFilePath}\n`);
  expect(rendered).toContain(`\ncli=${cliPath}\n`);
  expect(rendered).not.toContain("\nenv_file=/etc/");
  expect(rendered).not.toContain("\ncli=/opt/");
  await writeFile(wrapperPath, rendered);
});

afterAll(async () => {
  await rm(fixtureDir, { force: true, recursive: true });
});

test("the wrapper loads the env file, preserves arguments, and propagates the exit status", async () => {
  await writeFile(
    envFilePath,
    [
      "API_DATABASE=postgres",
      "QUOTED_SECRET='Bearer with spaces'",
      "FAKE_CLI_EXIT=3",
      "",
    ].join("\n"),
  );
  await installFakeCli();

  const result = await runWrapper(["make-admin", "abc def", "--flag=x y"]);

  expect(result.exitCode).toBe(3);
  expect(result.stderr).toBe("");
  expect(result.stdout.split("\n")).toEqual([
    "env:postgres|Bearer with spaces",
    "arg:make-admin",
    "arg:abc def",
    "arg:--flag=x y",
    "",
  ]);
  await expect(Bun.file(cliRanMarker).exists()).resolves.toBe(true);
  await rm(cliRanMarker, { force: true });
});

test.each([
  ["migrate", "5432|migration-login"],
  ["make-admin", "6432|runtime-login"],
])(
  "%s selects the appropriate database credentials",
  async (command, expectedConnection) => {
    await writeFile(
      envFilePath,
      "POSTGRES_PORT=6432\nPOSTGRES_USER=runtime-login\n",
    );
    await writeFile(
      migrationEnvFilePath,
      "POSTGRES_PORT=5432\nPOSTGRES_USER=migration-login\n",
    );
    await writeFile(
      cliPath,
      '#!/bin/sh\nprintf "%s|%s" "$POSTGRES_PORT" "$POSTGRES_USER"\n',
    );
    await chmod(cliPath, 0o755);

    const result = await runWrapper([command]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(expectedConnection);
  },
);

test.each(["make-admin", "migrate"])(
  "%s refuses to run without its env file",
  async (command) => {
    await installFakeCli();
    const missingPath =
      command === "migrate" ? migrationEnvFilePath : envFilePath;
    await rm(missingPath, { force: true });

    const result = await runWrapper([command]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(`${missingPath} is not readable`);
    expect(result.stdout).toBe("");
    await expect(Bun.file(cliRanMarker).exists()).resolves.toBe(false);
  },
);

test("the wrapper refuses to run when the CLI is not installed", async () => {
  await writeFile(envFilePath, "API_DATABASE=postgres\n");
  await writeFile(migrationEnvFilePath, "API_DATABASE=postgres\n");
  await rm(cliPath, { force: true });

  const result = await runWrapper(["migrate"]);

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain(`${cliPath} is not installed`);
  expect(result.stdout).toBe("");
  await expect(Bun.file(cliRanMarker).exists()).resolves.toBe(false);
});
