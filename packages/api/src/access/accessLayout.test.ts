import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const accessRoot = fileURLToPath(new URL(".", import.meta.url));

async function listSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return listSourceFiles(entryPath);
      }
      if (entry.isFile() && entry.name.endsWith(".ts")) {
        return [entryPath];
      }
      return [];
    }),
  );
  return files.flat();
}

function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const importPattern =
    /\b(?:import|export)\b(?:\s+type)?(?:[\s\S]*?\s+from\s+|\s*)["']([^"']+)["']/g;

  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1];
    if (specifier?.startsWith(".")) {
      specifiers.push(specifier);
    }
  }

  return specifiers;
}

function resolveAccessRelativeImport(fromFile: string, specifier: string) {
  const resolved = path.normalize(
    path.resolve(path.dirname(fromFile), specifier),
  );
  return path.relative(accessRoot, resolved).split(path.sep).join("/");
}

function accessLayer(relativePath: string) {
  if (relativePath.startsWith("read/")) {
    return "read";
  }
  if (relativePath.startsWith("write/")) {
    return "write";
  }
  if (relativePath.startsWith("shared/internal/")) {
    return "shared-internal";
  }
  return "other";
}

test("access internals follow the documented dependency direction", async () => {
  const violations: string[] = [];
  const files = await listSourceFiles(accessRoot);

  for (const file of files) {
    const source = await readFile(file, "utf8");
    const fromRelative = path
      .relative(accessRoot, file)
      .split(path.sep)
      .join("/");
    const fromLayer = accessLayer(fromRelative);

    for (const specifier of importSpecifiers(source)) {
      const toRelative = resolveAccessRelativeImport(file, specifier);
      const toLayer = accessLayer(toRelative);

      if (
        fromLayer === "shared-internal" &&
        (toLayer === "read" || toLayer === "write")
      ) {
        violations.push(`${fromRelative} -> ${toRelative}`);
      }

      if (fromRelative.startsWith("read/internal/") && toLayer === "write") {
        violations.push(`${fromRelative} -> ${toRelative}`);
      }
    }
  }

  expect(violations).toEqual([]);
});
