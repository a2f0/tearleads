import { createHash, randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// A staged map as the packaging hook leaves it: repository-relative sources,
// each with embedded content.
export const minimalSourceMap = JSON.stringify({
  version: 3,
  sources: ["src/main.ts"],
  sourcesContent: ["console.log(1);\n"],
  names: [],
  mappings: "AAAA",
});

export async function stageMinimalPairs(dist: string, chunk = "chunk-a1.js") {
  for (const script of ["bun/index.js", chunk]) {
    await Bun.write(join(dist, script), "console.log(1);\n");
    await Bun.write(join(dist, `${script}.map`), minimalSourceMap);
  }
}

// Bun writes map sources relative to the map; the packaging hook rewrites them
// relative to the repository, here `root`.
export async function repositoryRelativeSources(mapPath: string, root: string) {
  const map = JSON.parse(await readFile(mapPath, "utf8"));
  map.sources = map.sources.map((source: string) =>
    relative(root, resolve(dirname(mapPath), source)),
  );
  await writeFile(mapPath, JSON.stringify(map));
}

// A synthetic host secret outside staging.
export async function plantCanary(directory: string) {
  const bytes = `SYNTHETIC_HOST_SECRET_${randomBytes(12).toString("hex")}`;
  const path = join(directory, "canary.env");
  await Bun.write(path, `${bytes}\n`);
  return { path, bytes };
}

export const hostileMapVectors = [
  "relativeSource",
  "absoluteSource",
  "fileUrlSource",
  "sourceRoot",
  "missingContent",
  "nullContent",
  "indexedMap",
  "relativeMapReference",
  "absoluteMapReference",
  "fileUrlMapReference",
  "dataMapReference",
] as const;

export type HostileMapVector = (typeof hostileMapVectors)[number];

interface HostileContext {
  readonly map: Record<string, unknown>;
  readonly canary: string;
  readonly outsideMap: string;
  readonly tmp: string;
  readonly script: string;
}

const entry = { version: 3, names: [], mappings: "AAAA" };

// Each vector points the staged pair at the canary: through the map, which
// sentry-cli's default rewriting reads, or through the script's map reference.
// Relative sources resolve against sentry-cli's working directory, which
// runSentryCli creates directly below `tmp`.
const hostileMaps: Record<
  HostileMapVector,
  (context: HostileContext) => { map?: unknown; reference?: string }
> = {
  relativeSource: ({ map, canary, tmp }) => ({
    map: {
      ...map,
      sources: [`../${relative(tmp, canary)}`],
      sourcesContent: undefined,
    },
  }),
  absoluteSource: ({ map, canary }) => ({
    map: { ...map, sources: [canary], sourcesContent: undefined },
  }),
  fileUrlSource: ({ map, canary }) => ({
    map: {
      ...map,
      sources: [pathToFileURL(canary).href],
      sourcesContent: undefined,
    },
  }),
  sourceRoot: ({ map, canary }) => ({
    map: {
      ...map,
      sourceRoot: `${dirname(canary)}/`,
      sources: [basename(canary)],
      sourcesContent: undefined,
    },
  }),
  missingContent: ({ map }) => ({ map: { ...map, sourcesContent: undefined } }),
  nullContent: ({ map, canary }) => ({
    map: { ...map, sources: [canary], sourcesContent: [null] },
  }),
  indexedMap: ({ canary }) => ({
    map: {
      version: 3,
      sections: [
        {
          offset: { line: 0, column: 0 },
          map: { ...entry, sources: [canary] },
        },
      ],
    },
  }),
  relativeMapReference: ({ outsideMap, script }) => ({
    reference: relative(dirname(script), outsideMap),
  }),
  absoluteMapReference: ({ outsideMap }) => ({ reference: outsideMap }),
  fileUrlMapReference: ({ outsideMap }) => ({
    reference: pathToFileURL(outsideMap).href,
  }),
  dataMapReference: ({ canary }) => ({
    reference: `data:application/json;base64,${Buffer.from(JSON.stringify({ ...entry, sources: [canary] })).toString("base64")}`,
  }),
};

// Rewrites the staged pair of `script` for `vector`. A map beside the canary
// embeds its bytes, for the map references to point at.
export async function applyHostileMap(options: {
  script: string;
  vector: HostileMapVector;
  canary: string;
  tmp: string;
}) {
  const { script, vector, canary, tmp } = options;
  const outsideMap = join(dirname(canary), "outside.js.map");
  await writeFile(
    outsideMap,
    JSON.stringify({
      ...entry,
      sources: ["src/outside.ts"],
      sourcesContent: [await readFile(canary, "utf8")],
    }),
  );
  const map = JSON.parse(await readFile(`${script}.map`, "utf8"));
  const hostile = hostileMaps[vector]({ map, canary, outsideMap, tmp, script });
  if (hostile.map)
    await writeFile(`${script}.map`, JSON.stringify(hostile.map));
  if (hostile.reference)
    await writeFile(
      script,
      `${await readFile(script, "utf8")}\n//# sourceMappingURL=${hostile.reference}\n`,
    );
}

export function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

// Every staged file's digest, keyed by its path below `dist`.
export async function stagedDigests(dist: string) {
  const digests: Record<string, string> = {};
  for (const path of new Bun.Glob("**/*").scanSync({ cwd: dist }))
    digests[path] = sha256(await readFile(join(dist, path)));
  return digests;
}

// The decompressed files of the artifact bundle the fake Sentry assembled,
// keyed by their path below the app:/// URL prefix.
export function bundleFiles(bundlePath: string): Record<string, Buffer> {
  const listing = Bun.spawnSync(["unzip", "-Z1", bundlePath]);
  if (listing.exitCode !== 0)
    throw new Error(`No artifact bundle at ${bundlePath}`);
  const files: Record<string, Buffer> = {};
  for (const name of listing.stdout.toString().split("\n").filter(Boolean)) {
    const file = Bun.spawnSync(["unzip", "-p", bundlePath, name]);
    files[name.replace(/^files\/app\/_\//u, "")] = file.stdout;
  }
  return files;
}
