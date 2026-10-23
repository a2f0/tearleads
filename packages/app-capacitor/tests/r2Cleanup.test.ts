import { expect, test } from "bun:test";
import { chmod, cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../../..");
const endpoint =
  "https://11111111111111111111111111111111.r2.cloudflarestorage.com";
type Tier = "staging" | "prod";
const tiers: readonly Tier[] = ["staging", "prod"];
const otherTier = { staging: "prod", prod: "staging" } as const;
// Each stack's bucket and Terraform output shape, as the real wrappers print it.
const stacks = {
  storage: {
    bucket: (tier: Tier) => `tearleads-blobs-${tier}`,
    outputs: (bucket: string) => ({
      api_storage: {
        value: {
          blob_s3_bucket: bucket,
          blob_s3_endpoint: endpoint,
          blob_s3_access_key_id: "test-key",
          blob_s3_secret_access_key: "test-secret",
        },
      },
    }),
  },
  downloads: {
    bucket: (tier: Tier) => `tearleads-downloads-${tier}`,
    outputs: (bucket: string) => ({
      release_storage: {
        value: {
          bucket,
          endpoint,
          region: "auto",
          access_key_id: "test-key",
          secret_access_key: "test-secret",
        },
      },
    }),
  },
};
type Stack = keyof typeof stacks;

async function cleanupScenario(
  failure: string,
  stack: Stack = "storage",
  tier: Tier = "staging",
  args: string[] = [tier, stack],
  // destroyProduction.sh authorizes production steps; staging needs nothing.
  authorization = tier === "prod" ? "prod" : "",
) {
  const { PATH: inheritedPath } = process.env;
  const root = await mkdtemp(resolve(tmpdir(), "r2-cleanup-test-"));
  async function write(name: string, text: string) {
    const path = resolve(root, name);
    await mkdir(dirname(path), { recursive: true });
    await Bun.write(path, text);
    await chmod(path, 0o755);
  }
  try {
    await write("bin/git", `#!/bin/sh\nprintf '%s\\n' '${root}'\n`);
    await mkdir(resolve(root, "terraform/scripts"), { recursive: true });
    await cp(
      resolve(repoRoot, "terraform/scripts/teardownGuard.sh"),
      resolve(root, "terraform/scripts/teardownGuard.sh"),
    );
    const bucket = stacks[stack].bucket(
      failure === "identity" ? otherTier[tier] : tier,
    );
    for (const name of Object.keys(stacks) as Stack[]) {
      const outputs =
        name === stack ? JSON.stringify(stacks[name].outputs(bucket)) : "{}";
      await write(
        `terraform/scripts/run-${name}-stack.sh`,
        `#!/bin/sh
[ "$*" = '${tier} output -json' ] || exit 8
[ "$TEST_FAILURE" != output-read ] || exit 9
if [ "$TEST_FAILURE" = empty-state ]; then echo '{}'; exit 0; fi
printf '%s' '${outputs}'
`,
      );
    }
    await write(
      "bin/aws",
      `#!/bin/sh
[ "$AWS_ACCESS_KEY_ID" = test-key ] && [ "$AWS_SECRET_ACCESS_KEY" = test-secret ] || exit 9
[ -z "$AWS_SESSION_TOKEN" ] && [ -z "$AWS_PROFILE" ] || exit 9
[ "$AWS_REQUEST_CHECKSUM_CALCULATION" = when_required ] && [ "$AWS_RESPONSE_CHECKSUM_VALIDATION" = when_required ] || exit 9
printf '%s\\n' "$*" >> "$TEST_ROOT/calls"
case "$*" in
  *'s3 rm'*) [ "$TEST_FAILURE" != delete ] || exit 9 ;;
  *'list-multipart-uploads'*)
    [ "$TEST_FAILURE" != empty-listing ] || exit 0
    if [ -f "$TEST_ROOT/aborted" ] && [ "$TEST_FAILURE" != residual-upload ]; then echo '{"Uploads":[]}'
    else echo '{"Uploads":[{"Key":"blob/key","UploadId":"test-upload"}]}'
    fi ;;
  *'abort-multipart-upload'*) touch "$TEST_ROOT/aborted" ;;
  *'list-objects-v2'*)
    [ "$TEST_FAILURE" != listing-error ] || exit 9
    [ "$TEST_FAILURE" != empty-listing ] || exit 0
    if [ "$TEST_FAILURE" = malformed-listing ]; then echo 'not json'; exit 0; fi
    if [ "$TEST_FAILURE" = residual ]; then echo '{"Contents":[{"Key":"still-present"}]}'
    else echo '{"Contents":[]}'
    fi ;;
esac
`,
    );
    const child = Bun.spawn(
      [
        "bash",
        resolve(repoRoot, "terraform/scripts/empty-r2-bucket.sh"),
        ...args,
      ],
      {
        env: {
          ...process.env,
          PATH: `${root}/bin:${inheritedPath}`,
          TEST_ROOT: root,
          TEST_FAILURE: failure,
          TEARLEADS_TEARDOWN_TIER: authorization,
          AWS_PROFILE: "inherited",
          AWS_SESSION_TOKEN: "inherited",
          AWS_REQUEST_CHECKSUM_CALCULATION: "when_supported",
          AWS_RESPONSE_CHECKSUM_VALIDATION: "when_supported",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [code, stderr] = await Promise.all([
      child.exited,
      new Response(child.stderr).text(),
    ]);
    const calls = (await Bun.file(resolve(root, "calls")).exists())
      ? (await Bun.file(resolve(root, "calls")).text()).trim().split("\n")
      : [];
    return { code, stderr, calls };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

for (const tier of tiers) {
  for (const stack of Object.keys(stacks) as Stack[]) {
    test(`${tier} ${stack} cleanup empties its R2 bucket, aborts uploads, and verifies both listings`, async () => {
      const result = await cleanupScenario("", stack, tier);
      expect(result.code, result.stderr).toBe(0);
      expect(result.calls).toHaveLength(5);
      expect(result.calls[2]).toContain(
        `abort-multipart-upload --bucket ${stacks[stack].bucket(tier)} --key blob/key --upload-id test-upload`,
      );
      expect(result.calls[3]).toContain("list-objects-v2");
      expect(result.calls[4]).toContain("list-multipart-uploads");
      for (const call of result.calls)
        expect(call).toContain(".r2.cloudflarestorage.com --region auto");
    });

    test(`${tier} ${stack} cleanup refuses the ${otherTier[tier]} bucket before any object access`, async () => {
      const result = await cleanupScenario("identity", stack, tier);
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain(`unexpected ${tier} R2 bucket`);
      expect(result.calls).toEqual([]);
    });
  }
}

for (const authorization of ["", "staging"]) {
  test(`production cleanup ${authorization ? "authorized for staging" : "without authorization"} refuses before reading Terraform`, async () => {
    const result = await cleanupScenario(
      "output-read",
      "storage",
      "prod",
      ["prod", "storage"],
      authorization,
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("scripts/deploy/destroyProduction.sh");
    expect(result.calls).toEqual([]);
  });
}

for (const args of [
  [],
  ["staging"],
  ["storage"],
  ["staging", "storage", "downloads"],
  ["staging", "continuity"],
  ["unknown", "storage"],
]) {
  test(`cleanup rejects ${JSON.stringify(args)} before reading Terraform`, async () => {
    const result = await cleanupScenario(
      "output-read",
      "storage",
      "staging",
      args,
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/Usage:|Unknown teardown tier/);
    expect(result.calls).toEqual([]);
  });
}

for (const failure of ["delete", "residual", "residual-upload"]) {
  test(`staging cleanup reports ${failure} failure instead of allowing teardown`, async () => {
    const result = await cleanupScenario(failure);
    expect(result.code).not.toBe(0);
    expect(result.calls).toHaveLength(failure === "delete" ? 1 : 5);
    if (failure !== "delete") {
      expect(result.stderr).toContain(
        failure === "residual"
          ? "still contains objects"
          : "still contains multipart uploads",
      );
      expect(result.stderr).toContain("refusing teardown");
    }
  });
}

test("staging cleanup reads a successful empty listing as an empty bucket", async () => {
  const result = await cleanupScenario("empty-listing");
  expect(result.code, result.stderr).toBe(0);
  expect(result.calls).toHaveLength(4);
  expect(result.calls.at(-1)).toContain("list-multipart-uploads");
});

for (const failure of ["listing-error", "malformed-listing"]) {
  test(`staging cleanup never treats a ${failure} as an empty bucket`, async () => {
    const result = await cleanupScenario(failure);
    expect(result.code).not.toBe(0);
    expect(result.calls.at(-1)).toContain("list-objects-v2");
  });
}

test("staging cleanup skips an unapplied or already destroyed stack", async () => {
  const result = await cleanupScenario("empty-state");
  expect(result.code, result.stderr).toBe(0);
  expect(result.calls).toEqual([]);
});

test("staging cleanup never treats a Terraform read failure as empty storage", async () => {
  const result = await cleanupScenario("output-read");
  expect(result.code).not.toBe(0);
  expect(result.calls).toEqual([]);
});
