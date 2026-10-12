// Prints the build-time constants the Worker bundle receives through
// `wrangler deploy --define`, one `NAME:expression` per line. Both the build
// identity and the bundle frame allowlist come from the checkout.
import { fileURLToPath } from "node:url";
import { apiBuildVersion, workerDiagnosticsBuild } from "./diagnosticsBuild";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

const defines = {
  API_BUILD_VERSION: JSON.stringify(apiBuildVersion(repoRoot)),
  API_DIAGNOSTICS_BUILD: JSON.stringify(workerDiagnosticsBuild(repoRoot)),
};

for (const [name, expression] of Object.entries(defines)) {
  console.log(`${name}:${expression}`);
}
