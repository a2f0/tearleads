import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

async function listOutputFiles(dirPath: string): Promise<string[]> {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const nestedFiles = await Promise.all(
    entries.map((entry) => {
      const entryPath = join(dirPath, entry.name);

      if (entry.isDirectory()) {
        return listOutputFiles(entryPath);
      }

      return entry.isFile() &&
        (entry.name.endsWith(".js") || entry.name.endsWith(".d.ts"))
        ? [entryPath]
        : [];
    }),
  );

  return nestedFiles.flat();
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveRelativeModuleSpecifier(
  filePath: string,
  specifier: string,
): Promise<string> {
  // Only an explicit .js suffix marks a specifier as already resolved. An
  // extname() check would also skip dotted basenames like
  // "./service.testFixtures" (extname returns ".testFixtures"), leaving an
  // extensionless — and therefore unresolvable — ESM import in dist.
  if (!specifier.startsWith(".") || specifier.endsWith(".js")) {
    return specifier;
  }

  const absoluteTarget = join(dirname(filePath), specifier);

  if (await pathExists(`${absoluteTarget}.js`)) {
    return `${specifier}.js`;
  }

  if (await pathExists(join(absoluteTarget, "index.js"))) {
    return `${specifier}/index.js`;
  }

  return specifier;
}

async function rewriteStaticSpecifiers(filePath: string): Promise<void> {
  const content = await readFile(filePath, "utf8");
  const replacements = await Promise.all(
    [...content.matchAll(/\b(from|import)\s+(["'])(\.[^"']+)\2/g)].map(
      async (match) => ({
        from: match[0],
        to: `${match[1]} ${match[2]}${await resolveRelativeModuleSpecifier(
          filePath,
          match[3] ?? "",
        )}${match[2]}`,
      }),
    ),
  );
  const nextContent = replacements.reduce(
    (rewrittenContent, replacement) =>
      rewrittenContent.replace(replacement.from, replacement.to),
    content,
  );

  if (nextContent !== content) {
    await writeFile(filePath, nextContent);
  }
}

const distPath = join(import.meta.dir, "..", "dist");
const outputFiles = await listOutputFiles(distPath);

await Promise.all(outputFiles.map(rewriteStaticSpecifiers));
