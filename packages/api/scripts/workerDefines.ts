// Prints the build-time constants the Worker bundle receives through
// `wrangler deploy --define`, one `NAME:expression` per line. The expressions
// are the same JSON literals the retired executable builder inlined.
import { fileURLToPath } from "node:url";
import { apiBuildVersion, diagnosticsBuild } from "./diagnosticsBuild";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

const defines = {
  API_BUILD_VERSION: JSON.stringify(apiBuildVersion(repoRoot)),
  API_DIAGNOSTICS_BUILD: JSON.stringify(diagnosticsBuild(repoRoot)),
};

for (const [name, expression] of Object.entries(defines)) {
  console.log(`${name}:${expression}`);
}
