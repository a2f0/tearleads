import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cacheFixture } from "./turboCache.testUtils";

interface Manifest {
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
}

const models = "//#check:protocol-models";
const negative = "//#check:protocol-negative-controls";
const postgres = "//#test:postgres-concurrency";
const windows = "//#test:windows-ci";
const native = [
  "//#test:native-android-ci",
  "app-capacitor#test:native-ios-ci",
] as const;
const [android, ios] = native;

test("website source and its version bump preserve unrelated task hashes", () => {
  const repo = cacheFixture();
  try {
    repo.write("packages/website/src/page.astro", "<h1>New copy</h1>\n");
    const path = "packages/website/package.json";
    const manifest = JSON.parse(readFileSync(join(repo.cwd, path), "utf8"));
    const version = manifest.version;
    manifest.version = "0.1.999";
    repo.write(path, JSON.stringify(manifest));
    const lock = readFileSync(join(repo.cwd, "bun.lock"), "utf8");
    const updated = lock.replace(
      `"name": "website",\n      "version": "${version}"`,
      '"name": "website",\n      "version": "0.1.999"',
    );
    expect(updated).not.toBe(lock);
    repo.write("bun.lock", updated);
    expect(repo.changed()).toEqual(["website#test"]);
  } finally {
    repo.close();
  }
});

// The iOS compile is an app-capacitor task, so the root manifest, which Turbo
// forces into every root task's hash, stays out of its key. app-capacitor's
// manifest stays in: it holds the check's command and Capacitor's sync hooks.
// Capacitor finds plugins through the package's locked dependencies.
test("the iOS compile keys on app-capacitor's manifest and plugins, not the root's", () => {
  const repo = cacheFixture();
  try {
    const read = (path: string) => readFileSync(join(repo.cwd, path), "utf8");
    const path = "packages/app-capacitor/package.json";
    const original = read(path);
    const manifest = JSON.parse(original) as Manifest;
    const rootManifest = JSON.parse(read("package.json")) as Manifest;
    rootManifest.scripts["fixture:root"] = "true";
    repo.write("package.json", JSON.stringify(rootManifest));
    const root = repo.changed();
    expect(root).toContain(android);
    expect(root).not.toContain(ios);

    const scripts = { ...manifest.scripts, "capacitor:sync:before": "true" };
    repo.write(path, JSON.stringify({ ...manifest, scripts }));
    expect(repo.changed()).toContain(ios);
    repo.write(path, original);
    expect(repo.changed()).not.toContain(ios);

    const plugin = manifest.dependencies["@capacitor/app"];
    const lock = read("bun.lock");
    const upgraded = lock
      .replaceAll(`"@capacitor/app": "${plugin}"`, '"@capacitor/app": "99.0.0"')
      .replaceAll(`"@capacitor/app@${plugin}"`, '"@capacitor/app@99.0.0"');
    expect(upgraded).not.toBe(lock);
    repo.write("bun.lock", upgraded);
    expect(repo.changed()).toContain(ios);
  } finally {
    repo.close();
  }
});

test.each([
  // Only the Android check builds and syncs the web bundle; the iOS compile
  // syncs a placeholder page, so web sources stay out of its hash.
  [
    "packages/ui/src/frame.tsx",
    ["app#test", "website#test", windows, android],
    [postgres, models, ios],
  ],
  [
    "packages/api/src/route.ts",
    ["@tearleads/api#test", "app#test", postgres],
    [windows, models],
  ],
  [
    "packages/client-sdk/src/client.ts",
    ["@tearleads/client-sdk#test", postgres, windows, android],
    [models, ios],
  ],
  // The CLI runs the KeePass reader from source. Keepass has no build script,
  // but its no-op build still hashes its sources into the CLI's ^build.
  [
    "packages/keepass/src/readKeepassDatabase.ts",
    ["@tearleads/keepass#test", "@tearleads/cli#test"],
    ["app#test", "@tearleads/api#test", models],
  ],
  // Tests are no build or runtime input: dependents keep their passes, while
  // lanes that run the package's own test files still miss.
  [
    "packages/api/src/route.test.ts",
    ["@tearleads/api#test", postgres],
    ["app#test", "@tearleads/bob-and-alice#test", "@tearleads/cli#test"],
  ],
  [
    "packages/client-sdk/src/client.test.ts",
    ["@tearleads/client-sdk#test"],
    ["@tearleads/api#test", "app#test", "@tearleads/bob-and-alice#test"],
  ],
  [
    "packages/app-electrobun/scripts/monitor.test.ts",
    ["app-electrobun#test", windows],
    ["app#test", "app-web#test"],
  ],
  [
    "formal/model/Model.tla",
    [models, negative],
    [postgres, windows, "website#test"],
  ],
  ["scripts/protocol/tlcTools.ts", [models, negative], [postgres, windows]],
  [
    "scripts/checks/testPostgresConcurrency.sh",
    [postgres],
    [models, negative, windows],
  ],
  [
    "scripts/lib/withBuildInfoEnv.sh",
    [windows, "app-web#test", android],
    [postgres, models, negative, ios],
  ],
  [
    "scripts/lib/packageVersions.ts",
    ["app-web#test"],
    [postgres, models, negative],
  ],
  ["bunfig.toml", [windows], [models, negative]],
  ["test/preload.ts", [windows], [models, negative]],
  ["mise.lock", [models, negative, android], [postgres, windows, ios]],
  [
    "packages/app-capacitor/ios/App/App.swift",
    native,
    [postgres, windows, models],
  ],
  ["packages/app-capacitor/capacitor.config.ts", native, [postgres, windows]],
  ["scripts/checks/testNativePurchaseBridge.sh", native, [postgres, windows]],
  [
    ".github/workflows/native-purchase-bridges.yml",
    native,
    [postgres, windows],
  ],
  [
    "packages/app-capacitor/src/index.tsx",
    ["app-capacitor#test", android],
    [postgres, windows, ios],
  ],
  [
    "packages/website/scripts/deployWebsite.sh",
    ["app-capacitor#test", "website#test"],
    [postgres, windows],
  ],
])(
  "cache inputs track %s and preserve unrelated passes",
  (path, required, unchanged) => {
    const repo = cacheFixture();
    try {
      repo.write(path, "changed fixture\n");
      const changed = repo.changed();
      for (const id of required) expect(changed).toContain(id);
      for (const id of unchanged) expect(changed).not.toContain(id);
    } finally {
      repo.close();
    }
  },
);

test.each([
  ["CI_POSTGRES_IMAGE", [postgres]],
  ["ImageVersion", [windows, ...native]],
  ["DEVELOPER_DIR", [ios]],
  ["TLC_JAVA_RUNTIME", [models, negative]],
  // Shards share every input but the shard, so without it a passing shard's
  // entry would answer for the others.
  ["PROTOCOL_MODEL_SHARD", [models]],
])("cache inputs include %s", (name, required) => {
  const repo = cacheFixture();
  try {
    expect(repo.changed({ [name]: "different-runtime" })).toEqual(
      required.toSorted(),
    );
  } finally {
    repo.close();
  }
});

test("the Postgres cache identity matches the CI service image", async () => {
  const ci = Bun.YAML.parse(
    await Bun.file(
      `${import.meta.dir}/../../../.github/workflows/ci.yml`,
    ).text(),
  ) as {
    jobs: Record<
      string,
      {
        services: { postgres: { image: string } };
        steps: { env?: { CI_POSTGRES_IMAGE?: string } }[];
      }
    >;
  };
  const job = ci.jobs["postgres-concurrency"];
  expect(job).toBeDefined();
  const step = job?.steps.find(({ env }) => env?.CI_POSTGRES_IMAGE);
  expect(step?.env?.CI_POSTGRES_IMAGE).toBe(job?.services.postgres.image);
});
