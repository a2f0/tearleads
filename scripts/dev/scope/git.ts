import { execFileSync } from "node:child_process";
import { root } from "./settings";

export function gitAt(cwd: string, ...args: string[]): string {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
  return execFileSync(
    "git",
    ["--no-replace-objects", "-c", "core.hooksPath=/dev/null", ...args],
    {
      cwd,
      env: { ...env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  ).trim();
}

export function git(...args: string[]): string {
  return gitAt(root, ...args);
}
