import { resolve } from "node:path";

export async function readDesktopReleaseStorage(bucket: string) {
  const tier =
    bucket === "tearleads-downloads-prod"
      ? "prod"
      : bucket === "tearleads-downloads-staging"
        ? "staging"
        : null;
  if (!tier) throw new Error("Unknown desktop release bucket");
  const child = Bun.spawn(
    [
      "bash",
      resolve(
        import.meta.dirname,
        "../../../terraform/scripts/run-downloads-stack.sh",
      ),
      tier,
      "output",
      "-json",
      "release_storage",
    ],
    { stdout: "pipe", stderr: "inherit" },
  );
  const [code, text] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
  ]);
  if (code !== 0)
    throw new Error("Cannot read R2 release credentials from Terraform");
  const value: unknown = JSON.parse(text);
  if (
    !value ||
    typeof value !== "object" ||
    !("bucket" in value) ||
    value.bucket !== bucket ||
    !("endpoint" in value) ||
    typeof value.endpoint !== "string" ||
    !/^https:\/\/[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/.test(
      value.endpoint,
    ) ||
    !("access_key_id" in value) ||
    typeof value.access_key_id !== "string" ||
    !value.access_key_id ||
    !("secret_access_key" in value) ||
    typeof value.secret_access_key !== "string" ||
    !value.secret_access_key
  )
    throw new Error("Invalid R2 release storage configuration");
  return {
    bucket,
    endpoint: value.endpoint,
    publicOrigin: `https://${tier === "prod" ? "downloads" : "downloads-staging"}.tearleads.com`,
    env: {
      ...process.env,
      AWS_ACCESS_KEY_ID: value.access_key_id,
      AWS_SECRET_ACCESS_KEY: value.secret_access_key,
      AWS_SESSION_TOKEN: undefined,
      AWS_SECURITY_TOKEN: undefined,
      AWS_PROFILE: undefined,
      AWS_DEFAULT_PROFILE: undefined,
      // The R2 S3 API supports the object checksums we explicitly supply.
      AWS_REQUEST_CHECKSUM_CALCULATION: "when_required",
      AWS_RESPONSE_CHECKSUM_VALIDATION: "when_required",
    },
  };
}
