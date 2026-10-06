import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

async function listOutputFiles(dirPath: string): Promise<string[]> {
  const entries = await readdir(dirPath, { recursive: true });
  return entries
    .filter((entry) => entry.endsWith(".js") || entry.endsWith(".d.ts"))
    .map((entry) => join(dirPath, entry));
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
  // "." and "../.." name directories: appending .js would name a sibling file.
  const namesDirectory = /(^|\/)\.\.?$/.test(specifier);

  if (!namesDirectory && (await pathExists(`${absoluteTarget}.js`))) {
    return `${specifier}.js`;
  }

  if (await pathExists(join(absoluteTarget, "index.js"))) {
    return `${specifier}/index.js`;
  }

  return specifier;
}

// Static imports and exports, and the import("./x") type references tsc
// writes into declarations, which node16 resolution also requires to carry an
// extension.
async function rewriteStaticSpecifiers(filePath: string): Promise<void> {
  const content = await readFile(filePath, "utf8");
  const replacements = await Promise.all(
    [
      ...content.matchAll(/\b(from\s+|import\s+|import\()(["'])(\.[^"']*)\2/g),
    ].map(async (match) => ({
      from: match[0],
      to: `${match[1]}${match[2]}${await resolveRelativeModuleSpecifier(
        filePath,
        match[3] ?? "",
      )}${match[2]}`,
    })),
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

// Adds the explicit .js (or /index.js) suffix ESM needs to every relative
// import in a compiled output directory. Packages that publish compiled output
// (client-sdk, windowing) run it on their dist after tsc; tests run it on a
// fixture directory.
const distPath = process.argv[2];
if (!distPath) {
  throw new Error("usage: bun scripts/lib/rewriteDistImports.ts <dist-dir>");
}
const outputFiles = await listOutputFiles(distPath);

await Promise.all(outputFiles.map(rewriteStaticSpecifiers));
