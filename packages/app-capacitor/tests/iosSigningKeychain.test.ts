import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const helperPath = resolve(
  import.meta.dir,
  "../fastlane/lib/ios_signing_keychain.rb",
);

const lifecycleScript = `
require "json"
require ARGV.fetch(0)

def exercise(environment, fail: false, setup_fail: false)
  events = []
  result = nil
  error = nil
  setup_password = nil
  yield_password = nil
  yield_readonly = nil
  begin
    result = IosSigningKeychain.with_temporary(
      environment: environment,
      setup: proc do |name, password|
        events << ["setup", name]
        setup_password = password
        raise "setup failed" if setup_fail
      end,
      cleanup: proc { |name| events << ["cleanup", name] }
    ) do
      events << ["yield", environment["MATCH_KEYCHAIN_NAME"]]
      yield_password = environment["MATCH_KEYCHAIN_PASSWORD"]
      yield_readonly = environment["MATCH_READONLY"]
      raise "build failed" if fail
      "built"
    end
  rescue StandardError => e
    error = e.message
  end
  {
    environment: environment,
    error: error,
    events: events,
    result: result,
    setup_password: setup_password,
    yield_password: yield_password,
    yield_readonly: yield_readonly
  }
end

puts JSON.generate(
  success: exercise({ "MATCH_KEYCHAIN_NAME" => "", "MATCH_KEYCHAIN_PASSWORD" => "login-secret", "MATCH_READONLY" => "false" }),
  failure: exercise({}, fail: true),
  setup_failure: exercise({ "MATCH_KEYCHAIN_NAME" => "", "MATCH_KEYCHAIN_PASSWORD" => "login-secret" }, setup_fail: true),
  custom: exercise({ "MATCH_KEYCHAIN_NAME" => "caller-keychain", "MATCH_KEYCHAIN_PASSWORD" => "caller-secret" })
)
`;

const contentionScript = `
require "json"
require ARGV.fetch(0)

lock_path = ARGV.fetch(1)
event_path = ARGV.fetch(2)
identifier = ARGV.fetch(3)
record = proc do |event|
  File.open(event_path, "a") do |file|
    file.flock(File::LOCK_EX)
    file.puts(JSON.generate([identifier, event]))
  end
end

IosSigningKeychain.with_temporary(
  environment: {},
  lock_path: lock_path,
  setup: proc do |_name, _password|
    record.call("setup")
    sleep 0.15
  end,
  cleanup: proc { |_name| record.call("cleanup") }
) do
  record.call("yield")
  sleep 0.15
end
`;

test("temporary signing keychain lifecycle preserves caller state", async () => {
  const child = Bun.spawn(["ruby", "-e", lifecycleScript, helperPath], {
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stderr, stdout] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
    new Response(child.stdout).text(),
  ]);
  expect(exitCode, stderr).toBe(0);

  const results = JSON.parse(stdout);
  expect(results.success.result).toBe("built");
  expect(results.success.events.map(([event]: string[]) => event)).toEqual([
    "setup",
    "yield",
    "cleanup",
  ]);
  expect(results.success.setup_password).toMatch(/^[0-9a-f]{64}$/);
  expect(results.success.yield_password).toBe(results.success.setup_password);
  expect(results.success.yield_readonly).toBe("true");
  expect(results.success.environment).toEqual({
    MATCH_KEYCHAIN_PASSWORD: "login-secret",
    MATCH_READONLY: "false",
  });

  expect(results.failure.error).toBe("build failed");
  expect(results.failure.events.map(([event]: string[]) => event)).toEqual([
    "setup",
    "yield",
    "cleanup",
  ]);
  expect(results.failure.setup_password).not.toBe(
    results.success.setup_password,
  );
  expect(results.failure.environment).toEqual({});

  expect(results.setup_failure.error).toBe("setup failed");
  expect(
    results.setup_failure.events.map(([event]: string[]) => event),
  ).toEqual(["setup", "cleanup"]);
  expect(results.setup_failure.environment).toEqual({
    MATCH_KEYCHAIN_PASSWORD: "login-secret",
  });

  expect(results.custom.result).toBe("built");
  expect(results.custom.events).toEqual([["yield", "caller-keychain"]]);
  expect(results.custom.environment).toEqual({
    MATCH_KEYCHAIN_NAME: "caller-keychain",
    MATCH_KEYCHAIN_PASSWORD: "caller-secret",
  });
});

test("temporary signing keychains serialize their global lifecycle", async () => {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "symcrypt-keychain-lock-"),
  );
  const lockPath = join(temporaryDirectory, "release.lock");
  const eventPath = join(temporaryDirectory, "events.jsonl");
  const children = ["first", "second"].map((identifier) =>
    Bun.spawn(
      [
        "ruby",
        "-e",
        contentionScript,
        helperPath,
        lockPath,
        eventPath,
        identifier,
      ],
      { stderr: "pipe", stdout: "pipe" },
    ),
  );

  try {
    const results = await Promise.all(
      children.map(async (child) => {
        const [exitCode, stderr] = await Promise.all([
          child.exited,
          new Response(child.stderr).text(),
          new Response(child.stdout).text(),
        ]);
        return { exitCode, stderr };
      }),
    );
    for (const result of results) {
      expect(result.exitCode, result.stderr).toBe(0);
    }

    const events: [string, string][] = (await Bun.file(eventPath).text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(events.map(([, event]) => event)).toEqual([
      "setup",
      "yield",
      "cleanup",
      "setup",
      "yield",
      "cleanup",
    ]);
    expect(
      new Set(events.slice(0, 3).map(([identifier]) => identifier)).size,
    ).toBe(1);
    expect(
      new Set(events.slice(3).map(([identifier]) => identifier)).size,
    ).toBe(1);
    expect(events[0]?.[0]).not.toBe(events[3]?.[0]);
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
});
