import {
  createSourceTextCheck,
  listProductionSourceFiles,
} from "./checkFactories";
import { packageSourcePath } from "./dependencySourceRoots";

// Every request to the Tearleads API goes through @tearleads/api-client, the
// one transport that measures, renews sessions, and classifies failures. This
// check scans client-side packages for raw network primitives. It is a line
// heuristic: a call, a `fetch` passed as a value, a global `.fetch`,
// XMLHttpRequest, WebSocket/EventSource construction, or sendBeacon.
export const rawNetworkPrimitivePattern =
  /(?<![\w$.])fetch\s*\(|\b(?:globalThis|window|self)\s*\.\s*fetch\b|(?:\?\?|\|\||[=:,(])\s*fetch\s*(?:[,;)]|$)|\bXMLHttpRequest\b|\bnew\s+(?:WebSocket|EventSource)\b|\bsendBeacon\b/;

export const apiTransportEntryPoints = [
  packageSourcePath.app,
  packageSourcePath.appCapacitor,
  packageSourcePath.appElectrobun,
  packageSourcePath.appWeb,
  packageSourcePath.clientSdk,
  packageSourcePath.diagnostics,
  packageSourcePath.sqliteWorker,
  packageSourcePath.ui,
  packageSourcePath.website,
  packageSourcePath.windowing,
];

/**
 * Files that legitimately use the network outside the API client. Each one
 * talks to something other than the Tearleads API; docs/developer/api-network-failures.md
 * lists them for reviewers.
 */
export const nonApiNetworkSourceFiles: ReadonlyMap<string, string> = new Map([
  [
    `${packageSourcePath.appCapacitor}/device/capacitorScanner.ts`,
    "reads the captured photo from the WebView's local file URL",
  ],
  [
    `${packageSourcePath.appElectrobun}/bun/index.ts`,
    "Bun main-process request handlers (server-side fetch callbacks)",
  ],
  [
    `${packageSourcePath.appElectrobun}/renderer/electrobunFileSaver.ts`,
    "posts a download to the local Bun host bridge",
  ],
  [
    `${packageSourcePath.diagnostics}/fetch.ts`,
    "Sentry envelopes and the packaged sentry-assets.json",
  ],
  [
    `${packageSourcePath.sqliteWorker}/bunFetchLock.ts`,
    "routes SQLite wasm file: loads under Bun",
  ],
  [
    `${packageSourcePath.website}/components/ScreenshotsBrowser.tsx`,
    "same-origin static screenshot manifest",
  ],
  ...["desktop", "linux", "macos", "windows"].map(
    (platform): [string, string] => [
      `${packageSourcePath.website}/${platform}Downloads.ts`,
      "installer metadata from the downloads bucket",
    ],
  ),
]);

export async function listApiTransportSourceFiles(
  dirPath: string,
): Promise<string[]> {
  const files = await listProductionSourceFiles(dirPath);
  return files.filter((filePath) => !nonApiNetworkSourceFiles.has(filePath));
}

export const apiTransportCheck = createSourceTextCheck({
  entryPoints: apiTransportEntryPoints,
  listFiles: listApiTransportSourceFiles,
  message:
    "Requests to the Tearleads API go through @tearleads/api-client (via the client SDK). Move the call there, or list a non-API use in scripts/architecture/apiTransport.ts with its reason.",
  name: "api-requests-use-api-client-transport",
  pattern: rawNetworkPrimitivePattern,
});
