import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  routeTemplates,
  workerDiagnosticsBuild,
} from "../../scripts/diagnosticsBuild";
import { routeApp } from "../routeApp";

const root = resolve(import.meta.dirname, "../../../..");

test("the compiled route allowlist covers Hono's registered endpoints", () => {
  const routes = new Set(workerDiagnosticsBuild(root).routeTemplates);
  expect(routes.size).toBeGreaterThan(1);
  const unmatched = routeApp.routes
    .filter((route) => route.method !== "ALL")
    .map((route) => route.path.replace(/:([^/]+)/g, "{$1}"))
    .filter((path) => !routes.has(path));
  expect([...new Set(unmatched)]).toEqual([]);
});

test("the registry route allowlist matches the published OpenAPI paths", () => {
  // The allowlist reads the operation registry; the generated document must
  // key exactly the same templates, so neither can drift from the other.
  const document: { paths: Record<string, unknown> } = JSON.parse(
    readFileSync(resolve(root, "docs/openapi.json"), "utf8"),
  );
  const [rootRoute, fallback, ...paths] = routeTemplates();
  expect([rootRoute, fallback]).toEqual(["/", "unmatched"]);
  expect(paths).toEqual([...new Set(Object.keys(document.paths))].sort());
});
