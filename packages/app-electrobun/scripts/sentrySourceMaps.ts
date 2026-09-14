import { existsSync, lstatSync } from "node:fs";
import {
  copyFile,
  mkdir,
  readFile,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import {
  isSentryCommit,
  isSentryEnvironment,
} from "@tearleads/diagnostics/config";
import {
  electrobunSentryDist,
  rendererScriptPattern,
} from "../src/diagnostics/sentryConfig";
import {
  type ElectrobunSentryTarget,
  electrobunSentryTargets,
  hutchBuildTarget,
} from "../src/diagnostics/sentryTarget";

export function isInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return (
    rel !== "" &&
    rel !== ".." &&
    !rel.startsWith(`..${sep}`) &&
    !isAbsolute(rel)
  );
}

// Staging must not exist yet and must sit outside the swept build directory, so
// a stale or foreign directory can neither be uploaded nor deleted.
export async function prepareSourceMapStaging(options: {
  stagingDir: string;
  buildDir: string;
}): Promise<void> {
  const { stagingDir, buildDir } = options;
  if (
    !isAbsolute(stagingDir) ||
    basename(stagingDir) !== "sentry-sourcemaps" ||
    existsSync(stagingDir) ||
    resolve(stagingDir) === resolve(buildDir) ||
    isInside(resolve(buildDir), resolve(stagingDir))
  )
    throw new Error(`Refusing to stage source maps into ${stagingDir}`);
  await mkdir(stagingDir, { recursive: true });
}

function parseSourceMap(text: string, name: string) {
  const map: unknown = JSON.parse(text);
  if (typeof map !== "object" || map === null || !("sources" in map))
    throw new Error(`Source map ${name} has no sources`);
  const { sources } = map;
  if (
    !Array.isArray(sources) ||
    !sources.every((source) => typeof source === "string")
  )
    throw new Error(`Source map ${name} has no sources`);
  if ("sourceRoot" in map && map.sourceRoot)
    throw new Error(`Source map ${name} sets a sourceRoot`);
  return { map, sources };
}

// Bun writes renderer sources relative to the map, while Hutch writes the main
// bundle's relative to its working directory, which the release harness runs
// from a temporary root. Accept the first base under which every source is a
// real repository file, so no machine path or foreign source reaches Sentry.
async function rewriteMapSources(
  mapPath: string,
  repoRoot: string,
  packageRoot: string,
): Promise<string> {
  const name = basename(mapPath);
  const { map, sources } = parseSourceMap(
    await readFile(mapPath, "utf8"),
    name,
  );
  for (const base of [dirname(mapPath), process.cwd(), packageRoot]) {
    const paths = sources.map((source) => resolve(base, source));
    if (paths.every((path) => isInside(repoRoot, path) && existsSync(path)))
      return JSON.stringify({
        ...map,
        sources: paths.map((path) => relative(repoRoot, path)),
      });
  }
  throw new Error(`Source map ${name} has sources outside the repository`);
}

// The packaging hook stages a release under its dist: the tier the wrapper
// configured and the target Hutch is building. Uploads take the dist from that
// directory, so the maps go up under the identity their bundles report.
export function hutchSourceMapIdentity(
  environment: Readonly<Record<string, string | undefined>>,
): { target: ElectrobunSentryTarget; dist: string } {
  const { BUN_PUBLIC_SENTRY_ELECTROBUN_ENVIRONMENT: tier } = environment;
  if (!isSentryEnvironment(tier))
    throw new Error("Desktop source-map staging requires a release tier");
  const target = hutchBuildTarget(environment);
  return { target, dist: electrobunSentryDist(tier, target) };
}

export async function stageMainProcessSourceMap(options: {
  appDir: string;
  stagingDir: string;
  commit: string | undefined;
  target: ElectrobunSentryTarget;
  repoRoot: string;
  packageRoot: string;
}): Promise<void> {
  const { appDir, stagingDir, commit, target } = options;
  const bundle = join(appDir, "bun/index.js");
  if (!existsSync(`${bundle}.map`))
    throw new Error(
      "Electrobun did not emit bun/index.js.map; build.bun.sourcemap was not applied",
    );
  const text = await readFile(bundle, "utf8");
  if (
    !isSentryCommit(commit) ||
    !text.includes(commit) ||
    !text.includes(JSON.stringify(target)) ||
    text.includes("TEARLEADS_ELECTROBUN_MAIN_SENTRY")
  )
    throw new Error("Electrobun did not apply the main-process Sentry define");
  const map = await rewriteMapSources(
    `${bundle}.map`,
    options.repoRoot,
    options.packageRoot,
  );
  await mkdir(join(stagingDir, "bun"), { recursive: true });
  await copyFile(bundle, join(stagingDir, "bun/index.js"));
  await writeFile(join(stagingDir, "bun/index.js.map"), map);
}

export async function stageRendererSourceMap(options: {
  mainViewDir: string;
  stagingDir: string;
  outputs: readonly Pick<Bun.BuildArtifact, "kind" | "path">[];
  repoRoot: string;
  packageRoot: string;
}): Promise<void> {
  const { mainViewDir, stagingDir, outputs } = options;
  const scripts = outputs.filter((output) => output.path.endsWith(".js"));
  const [script] = scripts;
  if (scripts.length !== 1 || !script)
    throw new Error(
      `Expected one renderer chunk in ${mainViewDir}, found ${scripts.length}`,
    );
  const name = basename(script.path);
  if (
    dirname(script.path) !== mainViewDir ||
    !rendererScriptPattern.test(`/${name}`)
  )
    throw new Error(`Renderer chunk ${name} is not the reported script`);
  // BuildArtifact.sourcemap is not trusted; the emitted file set is.
  const maps = outputs.filter((output) => output.kind === "sourcemap");
  if (maps.length !== 1 || maps[0]?.path !== `${script.path}.map`)
    throw new Error(`Expected ${name}.map beside the renderer chunk`);
  const map = await rewriteMapSources(
    `${script.path}.map`,
    options.repoRoot,
    options.packageRoot,
  );
  await copyFile(script.path, join(stagingDir, name));
  await writeFile(join(stagingDir, `${name}.map`), map);
}

export async function sweepSourceMaps(root: string): Promise<void> {
  for await (const path of new Bun.Glob("**/*.map").scan({
    cwd: root,
    dot: true,
  }))
    await unlink(join(root, path));
}

function isStagedPairSet(entries: readonly string[], dist: string): boolean {
  const [root, bunDir, main, mainMap, chunk = "", chunkMap] = entries;
  const prefix = `${dist}/`;
  return (
    entries.length === 6 &&
    root === dist &&
    bunDir === `${prefix}bun` &&
    main === `${prefix}bun/index.js` &&
    mainMap === `${prefix}bun/index.js.map` &&
    chunk.startsWith(prefix) &&
    rendererScriptPattern.test(`/${chunk.slice(prefix.length)}`) &&
    chunkMap === `${chunk}.map`
  );
}

export interface StagedSourceMapIdentity {
  readonly environment: "staging" | "production";
  // The Linux host names the target it released; a build accepts the target
  // Hutch staged.
  readonly target?: ElectrobunSentryTarget;
}

// Staging must hold one dist directory for the expected tier and target, with
// exactly the renderer and main-process pairs, as real, unlinked files in real
// directories. A Linux release copies staging out of its build container, and a
// link there would upload a host file instead. Returns the dist.
export function assertStagedSourceMaps(
  stagingDir: string,
  identity: StagedSourceMapIdentity,
): string {
  const staged = existsSync(stagingDir) && lstatSync(stagingDir).isDirectory();
  const entries = staged
    ? [
        ...new Bun.Glob("**").scanSync({
          cwd: stagingDir,
          dot: true,
          onlyFiles: false,
        }),
      ].sort()
    : [];
  const [dist = ""] = entries;
  const directories = [dist, `${dist}/bun`];
  const linked = entries.filter((path) => {
    const stats = lstatSync(join(stagingDir, path));
    return directories.includes(path)
      ? !stats.isDirectory()
      : !stats.isFile() || stats.nlink !== 1;
  });
  const dists = electrobunSentryTargets
    .filter((target) => (identity.target ?? target) === target)
    .map((target) => electrobunSentryDist(identity.environment, target));
  if (
    !staged ||
    !dists.some((expected) => expected === dist) ||
    !isStagedPairSet(entries, dist) ||
    linked.length > 0
  )
    throw new Error(
      `Unexpected desktop source-map staging contents: ${entries.join(", ")}; expected ${dists.join(" or ")}`,
    );
  return dist;
}

// Uploads exactly the staged pairs under their dist, from the dist directory,
// then removes staging whatever happens. A failed upload must stop the release
// before publishing.
export async function uploadDesktopSourceMaps(
  stagingDir: string,
  identity: StagedSourceMapIdentity,
  upload: (dist: string, directory: string) => Promise<number>,
): Promise<void> {
  try {
    const dist = assertStagedSourceMaps(stagingDir, identity);
    if ((await upload(dist, join(stagingDir, dist))) !== 0)
      throw new Error(
        "Desktop source map upload failed; release must not be published",
      );
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
  }
}

export function desktopSourceMapUploadArgs(options: {
  org: string;
  project: string;
  release: string;
  dist: string;
  directory: string;
}): string[] {
  return [
    "sourcemaps",
    "upload",
    "--org",
    options.org,
    "--project",
    options.project,
    "--release",
    options.release,
    "--dist",
    options.dist,
    "--url-prefix",
    "app:///",
    "--validate",
    "--strict",
    "--wait-for",
    "60",
    options.directory,
  ];
}
