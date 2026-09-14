import {
  accessSync,
  constants,
  existsSync,
  lstatSync,
  realpathSync,
} from "node:fs";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { isInside } from "./sentrySourceMaps";

// The pinned sentry-cli binary is the only process that holds the upload token.
// sentry-cli 3.7.0 also takes its URL, proxy, TLS and exit-status behaviour from
// SENTRY_* and proxy variables, from dotenv files in its working directory and
// every ancestor, from .sentryclirc in its working directory, every ancestor and
// HOME, and from HOME's Library/Application Support/sentry/sentrycli.ini. A Bun
// or npm shim in between would load Bun's dotenv files too. So the binary runs
// directly, from a fresh empty directory that is its HOME and working directory,
// with nothing inherited and its URL pinned.

const packageRoot = realpathSync(resolve(import.meta.dirname, ".."));
const dependencyRoot = realpathSync(resolve(packageRoot, "../../node_modules"));

export interface SentryUploadEndpoint {
  // Passed as --url; an org auth token's embedded URL must also be allowed.
  readonly url: string;
  readonly isAllowed: (url: URL) => boolean;
}

const hostedSentryHosts = new Set([
  "sentry.io",
  "us.sentry.io",
  "de.sentry.io",
]);

// https://sentry.io/ is sentry-cli's own default. Org auth tokens embed the URL
// of the Sentry that issued them; hosted organizations live in the us or de
// region.
export const hostedSentryEndpoint: SentryUploadEndpoint = {
  url: "https://sentry.io/",
  isAllowed: (url) =>
    hostedSentryHosts.has(url.hostname) &&
    url.href === `https://${url.hostname}/`,
};

const orgAuthTokenPattern = /^sntrys_([A-Za-z0-9+/]+={0,2})_[A-Za-z0-9]+$/u;

function embeddedTokenUrl(token: string): URL | null {
  const payload = orgAuthTokenPattern.exec(token)?.[1];
  if (payload === undefined) return null;
  const claims = Buffer.from(payload, "base64");
  const canonical = claims.toString("base64");
  if (payload !== canonical && payload !== canonical.replace(/=+$/u, ""))
    return null;
  try {
    const parsed: unknown = JSON.parse(claims.toString("utf8"));
    return typeof parsed === "object" &&
      parsed !== null &&
      "url" in parsed &&
      typeof parsed.url === "string"
      ? URL.parse(parsed.url)
      : null;
  } catch {
    return null;
  }
}

// sentry-cli sends every request to the URL embedded in an org auth token
// (sntrys_<base64 JSON claims>_<secret>), overriding --url. Any token it could
// read that way must be canonical and embed an allowed URL; other tokens use
// the endpoint URL.
export function sentryCliUploadUrl(
  token: string,
  endpoint: SentryUploadEndpoint,
): string {
  if (!/sntrys_/iu.test(token)) return endpoint.url;
  const url = embeddedTokenUrl(token);
  if (!url || !endpoint.isAllowed(url))
    throw new Error(
      "The Sentry org auth token does not embed an allowed Sentry URL",
    );
  return url.href;
}

export function sentryCliCommand(options: {
  binary: string;
  directory: string;
  token: string;
  endpoint: SentryUploadEndpoint;
  args: readonly string[];
}): { argv: string[]; env: Record<string, string> } {
  const { binary, directory, token, endpoint, args } = options;
  return {
    argv: [binary, "--url", sentryCliUploadUrl(token, endpoint), ...args],
    env: {
      HOME: directory,
      TMPDIR: directory,
      SENTRY_AUTH_TOKEN: token,
      SENTRY_DISABLE_UPDATE_CHECK: "1",
      SENTRY_LOAD_DOTENV: "0",
    },
  };
}

const binaryPackages: Readonly<Record<string, string>> = {
  "darwin-arm64": "@sentry/cli-darwin",
  "darwin-x64": "@sentry/cli-darwin",
  "linux-arm64": "@sentry/cli-linux-arm64",
  "linux-x64": "@sentry/cli-linux-x64",
};

// The platform binary installed with this package's pinned @sentry/cli, found
// by module resolution rather than PATH, the npm shim or SENTRY_BINARY_PATH.
export function resolveSentryCliBinary(): string {
  const target = `${process.platform}-${process.arch}`;
  const name = binaryPackages[target];
  if (!name) throw new Error(`No pinned sentry-cli binary for ${target}`);
  const cli = realpathSync(
    Bun.resolveSync("@sentry/cli/package.json", packageRoot),
  );
  const binary = realpathSync(
    Bun.resolveSync(`${name}/bin/sentry-cli`, dirname(cli)),
  );
  if (!isInside(dependencyRoot, binary))
    throw new Error(`sentry-cli resolved outside ${dependencyRoot}: ${binary}`);
  accessSync(binary, constants.X_OK);
  return binary;
}

// sentry-cli reads .sentryclirc from the directory and each ancestor when it
// starts, after this check. So none may hold one yet, and each must be a real
// directory that only this user or root can change: under one another user can
// write, such as a TMPDIR of /tmp, a .sentryclirc could appear in between.
function assertNoInheritedConfig(directory: string): void {
  const uid = process.getuid?.();
  for (let current = directory; ; current = dirname(current)) {
    const stats = lstatSync(current);
    if (
      !stats.isDirectory() ||
      (stats.uid !== uid && stats.uid !== 0) ||
      (stats.mode & 0o022) !== 0
    )
      throw new Error(
        `Refusing to run sentry-cli below ${current}: another user could write there; set TMPDIR to a private directory`,
      );
    for (const name of [".sentryclirc", ".env"]) {
      const path = join(current, name);
      if (existsSync(path))
        throw new Error(`Refusing to run sentry-cli below ${path}`);
    }
    if (dirname(current) === current) return;
  }
}

export async function runSentryCli(options: {
  binary: string;
  token: string;
  endpoint: SentryUploadEndpoint;
  args: readonly string[];
}): Promise<number> {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), "tearleads-sentry-cli-")),
  );
  try {
    assertNoInheritedConfig(directory);
    const { argv, env } = sentryCliCommand({ ...options, directory });
    return await Bun.spawn(argv, {
      cwd: directory,
      env,
      stdin: "ignore",
      stdout: "inherit",
      stderr: "inherit",
    }).exited;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
