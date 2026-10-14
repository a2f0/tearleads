import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cacheFixture } from "./turboCache.testUtils";

const models = "//#check:protocol-models";
const negative = "//#check:protocol-negative-controls";
const postgres = "//#test:postgres-concurrency";
const windows = "//#test:windows-ci";
const native = ["//#test:native-android-ci", "//#test:native-ios-ci"];

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

test.each([
  [
    "packages/ui/src/frame.tsx",
    ["app#test", "website#test", windows, ...native],
    [postgres, models],
  ],
  [
    "packages/api/src/route.ts",
    ["@tearleads/api#test", "app#test", postgres],
    [windows, models],
  ],
  [
    "packages/client-sdk/src/client.ts",
    ["@tearleads/client-sdk#test", postgres, windows, ...native],
    [models],
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
  ["scripts/lib/withBuildInfoEnv.sh", [windows], [postgres, models, negative]],
  [
    "packages/app-capacitor/ios/App/App.swift",
    native,
    [postgres, windows, models],
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
  ["TLC_JAVA_RUNTIME", [models, negative]],
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
