import { expect, test } from "bun:test";
import { resolve } from "node:path";

const helperPath = resolve(
  import.meta.dir,
  "../fastlane/lib/ios_signing_keychain.rb",
);

const lifecycleScript = `
require "json"
require ARGV.fetch(0)

def exercise(environment, fail: false)
  events = []
  result = nil
  error = nil
  begin
    result = IosSigningKeychain.with_temporary(
      environment: environment,
      setup: proc { |name| events << ["setup", name] },
      cleanup: proc { |name| events << ["cleanup", name] }
    ) do
      events << ["yield", environment["MATCH_KEYCHAIN_NAME"]]
      raise "build failed" if fail
      "built"
    end
  rescue StandardError => e
    error = e.message
  end
  { environment: environment, error: error, events: events, result: result }
end

puts JSON.generate(
  success: exercise({ "MATCH_KEYCHAIN_NAME" => "", "MATCH_KEYCHAIN_PASSWORD" => "login-secret" }),
  failure: exercise({}, fail: true),
  custom: exercise({ "MATCH_KEYCHAIN_NAME" => "caller-keychain", "MATCH_KEYCHAIN_PASSWORD" => "caller-secret" })
)
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
  expect(results.success.environment).toEqual({
    MATCH_KEYCHAIN_PASSWORD: "login-secret",
  });

  expect(results.failure.error).toBe("build failed");
  expect(results.failure.events.map(([event]: string[]) => event)).toEqual([
    "setup",
    "yield",
    "cleanup",
  ]);
  expect(results.failure.environment).toEqual({});

  expect(results.custom.result).toBe("built");
  expect(results.custom.events).toEqual([["yield", "caller-keychain"]]);
  expect(results.custom.environment).toEqual({
    MATCH_KEYCHAIN_NAME: "caller-keychain",
    MATCH_KEYCHAIN_PASSWORD: "caller-secret",
  });
});
