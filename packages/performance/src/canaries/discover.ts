import { readdir, readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

/** `packages/app`, where the request-volume canaries live. */
export const appRoot = resolve(import.meta.dir, "../../../app");

/**
 * The app test helpers that print a `[dual-pane-request-metrics]` line when
 * `DUAL_PANE_REQUEST_PROFILE=1`: `measureWorkflowRequests` calls the first.
 */
const profileCalls = ["profileProxiedApiRequests(", "measureWorkflowRequests("];

export interface Canary {
  /** The file's base name without `.test.tsx`, as reports and filters use it. */
  readonly name: string;
  /** Relative to `packages/app`. */
  readonly file: string;
}

export function isCanarySource(text: string): boolean {
  return profileCalls.some((call) => text.includes(call));
}

function canaryName(file: string): string {
  return basename(file).replace(/\.test\.tsx?$/u, "");
}

/** Every app test file under `src` that profiles its proxied API requests. */
export async function discoverCanaries(root = appRoot): Promise<Canary[]> {
  const files = await readdir(resolve(root, "src"), { recursive: true });
  const canaries: Canary[] = [];
  for (const path of files) {
    if (!/\.test\.tsx?$/u.test(path)) continue;
    const file = `src/${path.split("\\").join("/")}`;
    if (isCanarySource(await readFile(resolve(root, file), "utf8")))
      canaries.push({ name: canaryName(file), file });
  }
  if (canaries.length === 0)
    throw new Error(
      `No request-volume canaries under ${resolve(root, "src")}: no test calls ${profileCalls.join(" or ")}`,
    );
  return canaries.sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
}

/**
 * Keeps the canaries whose name contains any filter, ignoring case. Every
 * filter must match at least one canary, so a typo fails instead of
 * silently measuring less.
 */
export function selectCanaries(
  canaries: readonly Canary[],
  filters: readonly string[],
): Canary[] {
  if (filters.length === 0) return [...canaries];
  const matches = (canary: Canary, filter: string) =>
    canary.name.toLowerCase().includes(filter.toLowerCase());
  for (const filter of filters)
    if (!canaries.some((canary) => matches(canary, filter)))
      throw new Error(
        `No canary matches "${filter}". Canaries: ${canaries.map((canary) => canary.name).join(", ")}.`,
      );
  return canaries.filter((canary) =>
    filters.some((filter) => matches(canary, filter)),
  );
}
