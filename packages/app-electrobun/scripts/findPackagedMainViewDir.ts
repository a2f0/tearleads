import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export function findPackagedMainViewDir(buildDir: string): string {
  let directories = [buildDir];
  const matches: string[] = [];
  for (let depth = 0; depth < 4; depth += 1) {
    const children: string[] = [];
    for (const directory of directories) {
      const candidate = join(directory, "Resources/app/views/mainview");
      if (existsSync(join(candidate, "index.html"))) matches.push(candidate);
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.isDirectory()) children.push(join(directory, entry.name));
      }
    }
    directories = children;
  }
  const [mainViewDir] = matches;
  if (matches.length !== 1 || !mainViewDir)
    throw new Error(
      `Expected one packaged mainview in ${buildDir}, found ${matches.length}`,
    );
  return mainViewDir;
}
