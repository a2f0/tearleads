import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";
import { configSchema } from "./types";

export const root = resolve(import.meta.dir, "../../..");
export const stateDir = join(root, ".scope");
const pins = z
  .object({
    judgeModel: z.string(),
    ports: z.object({
      api: z.number(),
      judge: z.number(),
      blob: z.number(),
      portal: z.number(),
    }),
  })
  .parse(JSON.parse(readFileSync(join(import.meta.dir, "pins.json"), "utf8")));
const { SCOPE_SOURCE_DIR, SCOPE_API_URL, SCOPE_TOKEN, CODEX_JUDGE_MODEL } =
  process.env;
const configPath = join(stateDir, "config.json");
export function getSavedConfig() {
  return existsSync(configPath)
    ? configSchema.parse(JSON.parse(readFileSync(configPath, "utf8")))
    : undefined;
}

export function loopbackOrigin(value: string): string {
  const url = new URL(value);
  if (
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("Scope endpoints must be loopback HTTP(S) origins.");
  }
  return url.origin;
}

export const settings = {
  sourceDir: SCOPE_SOURCE_DIR ?? join(homedir(), ".local/share/scope/source"),
  get apiUrl() {
    return loopbackOrigin(
      SCOPE_API_URL ??
        getSavedConfig()?.apiUrl ??
        `http://127.0.0.1:${pins.ports.api}`,
    );
  },
  blobOrigin: `http://127.0.0.1:${pins.ports.blob}`,
  judgePort: pins.ports.judge,
  portalPort: pins.ports.portal,
  judgeModel: CODEX_JUDGE_MODEL ?? pins.judgeModel,
};

export async function apiRequest(
  path: string,
  body?: unknown,
): Promise<unknown> {
  const headers = new Headers();
  if (SCOPE_TOKEN) headers.set("Authorization", `Bearer ${SCOPE_TOKEN}`);
  if (body !== undefined && !(body instanceof FormData))
    headers.set("Content-Type", "application/json");
  const response = await fetch(`${settings.apiUrl}/api/v1${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers,
    ...(body === undefined
      ? {}
      : { body: body instanceof FormData ? body : JSON.stringify(body) }),
    redirect: "error",
    signal: AbortSignal.timeout(120000),
  });
  if (!response.ok) throw new Error(`Scope ${path}: HTTP ${response.status}`);
  return response.json();
}
