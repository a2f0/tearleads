import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";

async function listJavaScriptFiles(dirPath: string): Promise<string[]> {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const nestedFiles = await Promise.all(
    entries.map((entry) => {
      const entryPath = join(dirPath, entry.name);

      if (entry.isDirectory()) {
        return listJavaScriptFiles(entryPath);
      }

      return entry.isFile() && entry.name.endsWith(".js") ? [entryPath] : [];
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
  if (!specifier.startsWith(".") || extname(specifier)) {
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
    [...content.matchAll(/\bfrom\s+(["'])(\.[^"']+)\1/g)].map(
      async (match) => ({
        from: match[0],
        to: `from ${match[1]}${await resolveRelativeModuleSpecifier(
          filePath,
          match[2] ?? "",
        )}${match[1]}`,
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
const javaScriptFiles = await listJavaScriptFiles(distPath);

await Promise.all(javaScriptFiles.map(rewriteStaticSpecifiers));
