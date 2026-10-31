import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  apiTransportEntryPoints,
  listApiTransportSourceFiles,
  nonApiNetworkSourceFiles,
  rawNetworkPrimitivePattern,
} from "./apiTransport";

const repoRoot = resolve(import.meta.dir, "../..");

test("flags every raw network primitive form", () => {
  for (const line of [
    "const response = await fetch(base + path, init);",
    "  () => fetch(url),",
    "const request = globalThis.fetch;",
    "window.fetch(url)",
    "  request: FetchDownload = fetch,",
    "const fetchPhoto = dependencies.fetchPhoto ?? fetch;",
    "(url) => (createSocket ? createSocket(url) : new WebSocket(url)),",
    "const source = new EventSource(url);",
    "navigator.sendBeacon(url, body);",
    "const xhr = new XMLHttpRequest();",
  ]) {
    expect({ line, matched: rawNetworkPrimitivePattern.test(line) }).toEqual({
      line,
      matched: true,
    });
  }
});

test("ignores names that merely contain fetch", () => {
  for (const line of [
    "await prefetch(ids);",
    "const response = await fetchPhoto(result.webPath);",
    "void refetch();",
    "return fetchWithTimeout(url, init);",
    "// Defers the fetch to the first loadStripe call.",
    "type FetchDownload = typeof fetch;",
  ]) {
    expect({ line, matched: rawNetworkPrimitivePattern.test(line) }).toEqual({
      line,
      matched: false,
    });
  }
});

test("the app's former raw server-events socket would fail the check", async () => {
  // Before the SDK owned it, the app opened the API socket itself.
  const formerLine =
    "    (url) => (createSocket ? createSocket(url) : new WebSocket(url)),";
  expect(rawNetworkPrimitivePattern.test(formerLine)).toBe(true);
  const files = (
    await Promise.all(
      apiTransportEntryPoints.map((entry) =>
        listApiTransportSourceFiles(resolve(repoRoot, entry)),
      ),
    )
  ).flat();
  expect(
    files.some((file) =>
      file.endsWith("providers/sdk/serverEventsConnectionLoop.ts"),
    ),
  ).toBe(true);
});

test("every exempt file exists and names its non-API use", () => {
  for (const [filePath, reason] of nonApiNetworkSourceFiles) {
    expect({
      filePath,
      exists: existsSync(resolve(repoRoot, filePath)),
    }).toEqual({ filePath, exists: true });
    expect(reason.length).toBeGreaterThan(0);
  }
});
