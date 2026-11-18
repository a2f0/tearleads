import { realpathSync } from "node:fs";
import { resolve } from "node:path";

// Checks normally target the checkout that owns them. Fixture runners can
// explicitly supply a different source tree.
const variable = "TEARLEADS_CHECK_ROOT";
const selected = process.env[variable];
export const checkRoot = realpathSync(
  selected ?? resolve(import.meta.dir, "../.."),
);
// Keep an explicitly selected tree stable across child-process cwd changes.
if (selected) process.env[variable] = checkRoot;
