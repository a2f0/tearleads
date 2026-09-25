import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { ciScopes } from "./ciPolicy";

const {
  CI_BASE_SHA: base,
  CI_HEAD_SHA: head,
  GITHUB_OUTPUT: output,
} = process.env;
if (!output) throw new Error("GITHUB_OUTPUT is required.");
let scopes = { native: true, terraform: true };
if (base && !/^0+$/.test(base)) {
  if (!/^[a-f0-9]{40}$/.test(base) || !head || !/^[a-f0-9]{40}$/.test(head)) {
    throw new Error("CI diff requires full base and head commit SHAs.");
  }
  const paths = execFileSync(
    "git",
    ["diff", "--name-only", "--no-renames", "-z", `${base}...${head}`, "--"],
    { encoding: "utf8" },
  ).split("\0");
  scopes = ciScopes(paths);
}
for (const [name, required] of Object.entries(scopes)) {
  appendFileSync(output, `${name}=${String(required)}\n`);
}
