import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { ciDiffRange, ciScopes } from "./ciPolicy";

const {
  CI_BASE_SHA: base,
  CI_HEAD_SHA: head,
  GITHUB_OUTPUT: output,
} = process.env;
if (!output) throw new Error("GITHUB_OUTPUT is required.");
let scopes = { native: true, terraform: true };
const range = ciDiffRange(base, head);
if (range) {
  const paths = execFileSync(
    "git",
    ["diff", "--name-only", "--no-renames", "-z", range, "--"],
    { encoding: "utf8" },
  ).split("\0");
  scopes = ciScopes(paths);
}
for (const [name, required] of Object.entries(scopes)) {
  appendFileSync(output, `${name}=${String(required)}\n`);
}
