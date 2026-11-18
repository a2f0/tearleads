import { realpathSync } from "node:fs";
import { resolve } from "node:path";

// Checks normally target the checkout that owns them. Fixture runners can
// explicitly supply a different source tree.
const { TEARLEADS_CHECK_ROOT } = process.env;
export const checkRoot = realpathSync(
  TEARLEADS_CHECK_ROOT ?? resolve(import.meta.dir, "../.."),
);
