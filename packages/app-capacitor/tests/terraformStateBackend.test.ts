import { expect, test } from "bun:test";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../../..");
const read = (path: string) => Bun.file(resolve(root, path)).text();
const scan = (pattern: string) =>
  [...new Bun.Glob(pattern).scanSync({ cwd: root })].sort();

// The R2 bucket was created by hand, outside Terraform. Each stack keeps its
// own object in it and locks with an S3 lockfile beside that object.
const r2Backend = (key: string) => ({
  bucket: '"tearleads-terraform-state"',
  key: `"${key}"`,
  region: '"auto"',
  endpoints: "{",
  s3: '"https://0be508e6c4caa573595c5f94e11900e4.r2.cloudflarestorage.com"',
  use_lockfile: "true",
  use_path_style: "true",
  skip_credentials_validation: "true",
  skip_metadata_api_check: "true",
  skip_region_validation: "true",
  skip_requesting_account_id: "true",
  skip_s3_checksum: "true",
});

function backendSettings(versions: string) {
  const blocks = versions.match(/^ {2}backend "s3" \{\n[\s\S]*?\n {2}\}$/gm);
  expect(blocks).toHaveLength(1);
  const settings: Record<string, string> = {};
  for (const line of blocks?.[0]?.split("\n").slice(1, -1) ?? []) {
    const setting = /^\s*([a-z0-9_]+)\s*=\s*(.+)$/.exec(line);
    if (setting?.[1] && setting[2]) settings[setting[1]] = setting[2];
  }
  return settings;
}

test("every stack keeps its own state object in the R2 backend", async () => {
  const stacks = scan("terraform/stacks/*/*/versions.tf");
  expect(stacks.length).toBeGreaterThan(0);
  for (const path of stacks) {
    const [, , tier, stack] = path.split("/");
    expect(backendSettings(await read(path)), path).toEqual(
      r2Backend(`${tier}/${stack}/terraform.tfstate`),
    );
  }
});

test("no Terraform root or module configures the AWS provider", async () => {
  // The stack wrappers export the R2 state key as AWS credentials, which an
  // AWS provider would also read.
  for (const path of scan("terraform/{stacks,modules}/**/*.tf")) {
    const source = await read(path);
    expect(source, path).not.toMatch(/hashicorp\/aws\b/);
    expect(source, path).not.toMatch(/provider\s+"aws"/);
  }
});
