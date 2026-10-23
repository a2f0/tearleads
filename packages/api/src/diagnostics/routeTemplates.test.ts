import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { workerDiagnosticsBuild } from "../../scripts/diagnosticsBuild";
import { routeApp } from "../routeApp";

test("the compiled route allowlist covers Hono's registered endpoints", () => {
  const root = resolve(import.meta.dirname, "../../../..");
  const { routeTemplates } = workerDiagnosticsBuild(root);
  const routes = new Set(routeTemplates);
  expect(routes.size).toBeGreaterThan(1);
  const unmatched = routeApp.routes
    .filter((route) => route.method !== "ALL")
    .map((route) => route.path.replace(/:([^/]+)/g, "{$1}"))
    .filter((path) => !routes.has(path));
  expect([...new Set(unmatched)]).toEqual([]);
});
