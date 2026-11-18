import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { delimiter, dirname, resolve } from "node:path";

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
  // An exported tree without its own .git must never discover its parent.
  const ceilingVariable = "GIT_CEILING_DIRECTORIES";
  const ceilings = process.env[ceilingVariable];
  process.env[ceilingVariable] = [dirname(root), ceilings]
    .filter(Boolean)
    .join(delimiter);
  return root;
}

export function checkArguments() {
  const args = process.argv.slice(2);
  if (args[0] !== "--check-root") return { root: checkRoot(), args };
  const target = args[1];
  if (!target) throw new Error("--check-root requires a directory");
  return { root: checkRoot(realpathSync(target)), args: args.slice(2) };
}
