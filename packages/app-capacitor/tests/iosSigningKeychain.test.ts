import { expect, test } from "bun:test";
import { resolve } from "node:path";

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
  begin
    result = IosSigningKeychain.with_temporary(
      environment: environment,
      setup: proc do |name|
        events << ["setup", name]
        raise "setup failed" if setup_fail
      end,
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
  setup_failure: exercise({ "MATCH_KEYCHAIN_NAME" => "", "MATCH_KEYCHAIN_PASSWORD" => "login-secret" }, setup_fail: true),
  custom: exercise({ "MATCH_KEYCHAIN_NAME" => "caller-keychain", "MATCH_KEYCHAIN_PASSWORD" => "caller-secret" }),
  login_authorization: IosSigningKeychain.authorization_environment({ "MATCH_KEYCHAIN_PASSWORD" => "login-secret" }) { |name| "/resolved/#{name}" },
  custom_authorization: IosSigningKeychain.authorization_environment({ "MATCH_KEYCHAIN_NAME" => "caller-keychain", "MATCH_KEYCHAIN_PASSWORD" => "caller-secret" }) { |name| "/resolved/#{name}" }
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
  expect(results.login_authorization).toEqual({
    CODESIGN_KEYCHAIN_PASSWORD: "login-secret",
  });
  expect(results.custom_authorization).toEqual({
    CODESIGN_KEYCHAIN_PASSWORD: "caller-secret",
    CODESIGN_LOGIN_KEYCHAIN: "/resolved/caller-keychain",
  });
});
