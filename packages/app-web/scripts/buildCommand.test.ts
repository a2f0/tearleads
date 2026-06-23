import { expect, test } from "bun:test";
import packageJson from "../package.json";

test("production build emits root-relative app shell asset URLs", () => {
  expect(packageJson.scripts.build).toContain("--public-path=/");
});
