import { expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

const endpoint =
  "https://11111111111111111111111111111111.r2.cloudflarestorage.com";
// Each stack's Terraform output shape, as the real wrappers print it.
const stacks = {
  storage: {
    bucket: "tearleads-blobs-staging",
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
    bucket: "tearleads-downloads-staging",
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
  args: string[] = [stack],
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
    const bucket =
      failure === "identity"
        ? stacks[stack].bucket.replace("-staging", "-prod")
        : stacks[stack].bucket;
    for (const name of Object.keys(stacks) as Stack[]) {
      const outputs =
        name === stack ? JSON.stringify(stacks[name].outputs(bucket)) : "{}";
      await write(
        `terraform/scripts/run-${name}-stack.sh`,
        `#!/bin/sh
[ "$*" = 'staging output -json' ] || exit 8
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
        resolve(
          import.meta.dirname,
          "../../../terraform/scripts/empty-staging-bucket.sh",
        ),
        ...args,
      ],
      {
        env: {
          ...process.env,
          PATH: `${root}/bin:${inheritedPath}`,
          TEST_ROOT: root,
          TEST_FAILURE: failure,
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

for (const stack of Object.keys(stacks) as Stack[]) {
  test(`staging ${stack} cleanup empties its R2 bucket, aborts uploads, and verifies both listings`, async () => {
    const result = await cleanupScenario("", stack);
    expect(result.code, result.stderr).toBe(0);
    expect(result.calls).toHaveLength(5);
    expect(result.calls[2]).toContain(
      `abort-multipart-upload --bucket ${stacks[stack].bucket} --key blob/key --upload-id test-upload`,
    );
    expect(result.calls[3]).toContain("list-objects-v2");
    expect(result.calls[4]).toContain("list-multipart-uploads");
    for (const call of result.calls)
      expect(call).toContain(".r2.cloudflarestorage.com --region auto");
  });

  test(`staging ${stack} cleanup refuses a production bucket before any object access`, async () => {
    const result = await cleanupScenario("identity", stack);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("unexpected staging R2 bucket");
    expect(result.calls).toEqual([]);
  });
}

for (const args of [[], ["prod"], ["storage", "downloads"]]) {
  test(`staging cleanup rejects ${JSON.stringify(args)} before reading Terraform`, async () => {
    const result = await cleanupScenario("output-read", "storage", args);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Usage:");
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
