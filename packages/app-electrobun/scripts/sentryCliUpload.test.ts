import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import {
  hostedSentryEndpoint,
  resolveSentryCliBinary,
  sentryCliCommand,
  sentryCliUploadUrl,
} from "./sentryCliUpload";

const claims = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString("base64");
const orgToken = (url: string, secret = "Q".repeat(43)) =>
  `sntrys_${claims({ iat: 1, url, org: "tearleads" })}_${secret}`;

test("hosted uploads may only reach the sentry.io, us or de root over https", () => {
  for (const url of [
    "https://sentry.io",
    "https://sentry.io/",
    "https://us.sentry.io",
    "https://de.sentry.io/",
    "https://sentry.io:443/",
  ])
    expect(hostedSentryEndpoint.isAllowed(new URL(url))).toBe(true);
  for (const url of [
    "http://sentry.io/",
    "https://sentry.io:8443/",
    "https://user@sentry.io/",
    "https://sentry.io/api/",
    "https://sentry.io/?",
    "https://sentry.io/#",
    "https://sentry.io.example.com/",
    "https://evilsentry.io/",
    "https://o1.ingest.us.sentry.io/",
    "https://127.0.0.1/",
  ])
    expect(hostedSentryEndpoint.isAllowed(new URL(url))).toBe(false);
});

test("an org auth token's embedded URL is pinned only when it is allowed", () => {
  expect(
    sentryCliUploadUrl(`sntryu_${"0".repeat(64)}`, hostedSentryEndpoint),
  ).toBe("https://sentry.io/");
  expect(sentryCliUploadUrl("0".repeat(64), hostedSentryEndpoint)).toBe(
    "https://sentry.io/",
  );
  expect(
    sentryCliUploadUrl(orgToken("https://de.sentry.io"), hostedSentryEndpoint),
  ).toBe("https://de.sentry.io/");
  const unpadded = orgToken("https://us.sentry.io").replace(/=+_/u, "_");
  expect(sentryCliUploadUrl(unpadded, hostedSentryEndpoint)).toBe(
    "https://us.sentry.io/",
  );
  const refused = [
    orgToken("http://127.0.0.1:9"),
    orgToken("https://sentry.io.example.com"),
    `sntrys_${claims({ iat: 1, org: "tearleads" })}_${"Q".repeat(43)}`,
    `sntrys_${Buffer.from("not json").toString("base64")}_${"Q".repeat(43)}`,
    orgToken("https://sentry.io", "with_underscore"),
    orgToken("https://sentry.io").replace("sntrys_", "SNTRYS_"),
    ` ${orgToken("https://sentry.io")}`,
    `${orgToken("https://sentry.io")}\n`,
    `sntrys_${claims({ url: "http://127.0.0.1:9", org: "o" }).replaceAll("=", "")}A_${"Q".repeat(43)}`,
  ];
  for (const token of refused)
    expect(() => sentryCliUploadUrl(token, hostedSentryEndpoint)).toThrow(
      /does not embed an allowed Sentry URL/,
    );
});

test("the sentry-cli command pins its URL and inherits nothing", () => {
  expect(
    sentryCliCommand({
      binary: "/deps/sentry-cli",
      directory: "/tmp/isolated",
      token: `sntryu_${"0".repeat(64)}`,
      endpoint: hostedSentryEndpoint,
      args: ["sourcemaps", "upload"],
    }),
  ).toEqual({
    argv: [
      "/deps/sentry-cli",
      "--url",
      "https://sentry.io/",
      "sourcemaps",
      "upload",
    ],
    env: {
      HOME: "/tmp/isolated",
      TMPDIR: "/tmp/isolated",
      SENTRY_AUTH_TOKEN: `sntryu_${"0".repeat(64)}`,
      SENTRY_DISABLE_UPDATE_CHECK: "1",
      SENTRY_LOAD_DOTENV: "0",
    },
  });
});

test("sentry-cli resolves to the pinned binary in the repository's dependencies", async () => {
  const binary = resolveSentryCliBinary();
  expect(isAbsolute(binary)).toBe(true);
  expect(
    binary.startsWith(
      `${resolve(import.meta.dirname, "../../../node_modules")}/`,
    ),
  ).toBe(true);
  const directory = await mkdtemp(join(tmpdir(), "sentry-cli-version-"));
  try {
    const version = Bun.spawnSync([binary, "--version"], {
      cwd: directory,
      env: { HOME: directory, SENTRY_DISABLE_UPDATE_CHECK: "1" },
    });
    expect(version.stdout.toString().trim()).toBe("sentry-cli 3.7.0");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
