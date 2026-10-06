import { existsSync } from "node:fs";
import { readdir, readFile, rm } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

// A static import or export, a side-effect import, or a dynamic or type
// import, as tsc emits them: one statement per line.
export const moduleSpecifierPattern =
  /(^(?:import|export)\b[^\n]*?\bfrom\s*|^import\s*|\bimport\(\s*)(["'])([^"']+)\2/gm;

// Every module specifier in a compiled module or declaration file.
export function moduleSpecifiers(source: string) {
  return [...source.matchAll(moduleSpecifierPattern)].map(
    (match) => match[3] ?? "",
  );
}

// The package a bare specifier names: "zod", "@noble/hashes/sha2.js" ->
// "@noble/hashes".
export function packageName(specifier: string) {
  const segments = specifier.split("/");
  return segments.slice(0, specifier.startsWith("@") ? 2 : 1).join("/");
}

// Every file under a directory, relative to it.
export async function listFiles(directory: string) {
  const entries = await readdir(directory, {
    recursive: true,
    withFileTypes: true,
  });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(directory, join(entry.parentPath, entry.name)));
}

// The compiled modules and declarations under a directory, with their source.
export async function outputFiles(outDir: string) {
  const files = await listFiles(outDir);
  return Promise.all(
    files
      .filter((file) => file.endsWith(".js") || file.endsWith(".d.ts"))
      .map(async (file) => ({
        file,
        source: await readFile(join(outDir, file), "utf8"),
      })),
  );
}

// tsc declares every module it compiles, but a consumer's typecheck reads only
// the declarations the entry points reach. The rest are dead weight, and can
// name packages a module imports only for types the public API never exposes.
export async function pruneUnreachableDeclarations(
  outDir: string,
  entries: readonly string[],
) {
  const reachable = new Set<string>();
  const pending = [...entries];
  for (let file = pending.pop(); file; file = pending.pop()) {
    if (reachable.has(file)) {
      continue;
    }
    reachable.add(file);
    if (!existsSync(join(outDir, file))) {
      throw new Error(`a declaration imports ${file}, which was not emitted`);
    }
    const source = await readFile(join(outDir, file), "utf8");
    for (const specifier of moduleSpecifiers(source)) {
      if (specifier.startsWith(".")) {
        pending.push(join(dirname(file), specifier).replace(/\.js$/, ".d.ts"));
      }
    }
  }
  const declarations = (await listFiles(outDir)).filter((file) =>
    file.endsWith(".d.ts"),
  );
  for (const file of declarations) {
    if (!reachable.has(file)) {
      await rm(join(outDir, file));
    }
  }
}
