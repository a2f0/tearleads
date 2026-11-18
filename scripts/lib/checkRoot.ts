import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";

const ownerRoot = realpathSync(resolve(import.meta.dir, "../.."));

// Git names the metadata that applies only to one repository. Keep user-wide
// authentication and SSH settings when starting work in another checkout.
export function checkRoot(root = ownerRoot): string {
  if (Object.keys(process.env).some((key) => key.startsWith("GIT_"))) {
    const names = execFileSync("git", ["rev-parse", "--local-env-vars"], {
      cwd: root,
      encoding: "utf8",
      env: Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
      ),
    });
    for (const key of names.trim().split(/\s+/)) delete process.env[key];
  }
  return root;
}

// A source export nested in another repository must not use that history.
export function requireGitRoot(root = checkRoot()): string {
  if (
    !existsSync(join(root, ".git")) ||
    realpathSync(
      execFileSync("git", ["-C", root, "rev-parse", "--show-toplevel"], {
        encoding: "utf8",
      }).replace(/\n$/, ""),
    ) !== root
  )
    throw new Error(`This command requires its own Git checkout: ${root}`);
  return root;
}

export function checkArguments() {
  const args = process.argv.slice(2);
  if (args[0] !== "--check-root") return { root: checkRoot(), args };
  const target = args[1];
  if (!target) throw new Error("--check-root requires a directory");
  return { root: checkRoot(realpathSync(target)), args: args.slice(2) };
}
