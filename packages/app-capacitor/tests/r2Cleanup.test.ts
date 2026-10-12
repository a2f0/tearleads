import { expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

async function cleanupScenario(failure: string) {
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
    await write(
      "terraform/scripts/run-storage-stack.sh",
      `#!/bin/sh
[ "$*" = 'staging output -json api_storage' ] || exit 8
printf '{"blob_s3_bucket":"%s","blob_s3_endpoint":"https://11111111111111111111111111111111.r2.cloudflarestorage.com","blob_s3_access_key_id":"test-key","blob_s3_secret_access_key":"test-secret"}' "$TEST_BUCKET"
`,
    );
    await write(
      "bin/aws",
      `#!/bin/sh
[ "$AWS_ACCESS_KEY_ID" = test-key ] && [ "$AWS_SECRET_ACCESS_KEY" = test-secret ] || exit 9
[ -z "$AWS_SESSION_TOKEN" ] && [ -z "$AWS_PROFILE" ] || exit 9
printf '%s\\n' "$*" >> "$TEST_ROOT/calls"
case "$*" in
  *'s3 rm'*) [ "$TEST_FAILURE" != delete ] || exit 9 ;;
  *'list-multipart-uploads'*)
    if [ -f "$TEST_ROOT/aborted" ]; then echo '{"Uploads":[]}'
    else echo '{"Uploads":[{"Key":"blob/key","UploadId":"test-upload"}]}'
    fi ;;
  *'abort-multipart-upload'*) touch "$TEST_ROOT/aborted" ;;
  *'list-objects-v2'*)
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
          "../../../terraform/scripts/empty-staging-blobs.sh",
        ),
      ],
      {
        env: {
          ...process.env,
          PATH: `${root}/bin:${inheritedPath}`,
          TEST_ROOT: root,
          TEST_BUCKET:
            failure === "identity"
              ? "tearleads-blobs-prod"
              : "tearleads-blobs-staging",
          TEST_FAILURE: failure,
          AWS_PROFILE: "inherited",
          AWS_SESSION_TOKEN: "inherited",
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

test("staging cleanup empties its R2 bucket, aborts uploads, and verifies both listings", async () => {
  const result = await cleanupScenario("");
  expect(result.code, result.stderr).toBe(0);
  expect(result.calls).toHaveLength(5);
  expect(result.calls[2]).toContain(
    "abort-multipart-upload --bucket tearleads-blobs-staging --key blob/key --upload-id test-upload",
  );
  expect(result.calls[3]).toContain("list-objects-v2");
  expect(result.calls[4]).toContain("list-multipart-uploads");
  for (const call of result.calls)
    expect(call).toContain(".r2.cloudflarestorage.com --region auto");
});

test("staging cleanup refuses a production bucket before any object access", async () => {
  const result = await cleanupScenario("identity");
  expect(result.code).not.toBe(0);
  expect(result.stderr).toContain("unexpected staging R2 bucket");
  expect(result.calls).toEqual([]);
});

for (const failure of ["delete", "residual"]) {
  test(`staging cleanup reports ${failure} failure instead of allowing teardown`, async () => {
    const result = await cleanupScenario(failure);
    expect(result.code).not.toBe(0);
    expect(result.calls).toHaveLength(failure === "delete" ? 1 : 5);
  });
}
