import { expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  apiClientIndexPath,
  apiClientPackageJsonPath,
  apiClientRootExports,
  findApiClientSurfaceViolations,
  findEntryExportViolations,
  findPackageExportViolations,
} from "./apiClientSurface";

const index = apiClientIndexPath;
const manifest = apiClientPackageJsonPath;

test("the api-client package publishes exactly its transport surface", async () => {
  expect(
    await findApiClientSurfaceViolations(resolve(import.meta.dir, "../..")),
  ).toEqual([]);
  expect(new Set(apiClientRootExports).size).toBe(apiClientRootExports.length);
});

test("an entry exporting exactly the allowed names passes", () => {
  expect(
    findEntryExportViolations(
      [
        'export { ApiClient } from "./ApiClient";',
        'export { type RequestResult, ApiNetworkError } from "./types";',
        'export type { RequestFailure as Failure } from "./types";',
      ].join("\n"),
      ["ApiClient", "ApiNetworkError", "Failure", "RequestResult"],
    ),
  ).toEqual([]);
});

test("a protocol type, a local declaration or a default export is outside the surface", () => {
  expect(
    findEntryExportViolations(
      [
        'export { ApiClient } from "./ApiClient";',
        'export type { HeldDirectoryCitation } from "@tearleads/validators/response";',
        "export const MANIFEST_CITATION_DEADLINE_MS = 250;",
        "export interface WriterProjectionTarget { readonly id: string }",
        "export const { isHeldDirectoryCitation, nested: [signed] } = guards;",
        "export default ApiClient;",
      ].join("\n"),
      ["ApiClient"],
    ),
  ).toEqual(
    [
      "HeldDirectoryCitation",
      "MANIFEST_CITATION_DEADLINE_MS",
      "WriterProjectionTarget",
      "isHeldDirectoryCitation",
      "signed",
      "default",
    ].map((name) => ({
      detail: `exports ${name}, which is not part of the transport surface`,
      path: index,
    })),
  );
});

test("a wildcard re-export and a stale allowed name are violations", () => {
  expect(
    findEntryExportViolations(
      ['export * from "./types";', 'export * as routes from "./routes";'].join(
        "\n",
      ),
      ["ApiClient"],
    ),
  ).toEqual([
    {
      detail:
        're-exports a whole module (export * from "./types";); export names explicitly',
      path: index,
    },
    {
      detail:
        're-exports a whole module (export * as routes from "./routes";); export names explicitly',
      path: index,
    },
    {
      detail:
        "no longer exports ApiClient; remove it from apiClientRootExports",
      path: index,
    },
  ]);
});

test("the package may publish only its root index", () => {
  expect(
    findPackageExportViolations({ exports: { ".": "./src/index.ts" } }),
  ).toEqual([]);
  expect(
    findPackageExportViolations({
      exports: { ".": "./src/index.ts", "./types": "./src/types.ts" },
    }),
  ).toEqual([
    {
      detail: "exports subpath ./types; publish only the root entry point",
      path: manifest,
    },
  ]);
  for (const packageJson of [
    {},
    { exports: { ".": "./src/ApiClient.ts" } },
    { exports: "./src/index.ts" },
  ])
    expect(findPackageExportViolations(packageJson)).toContainEqual({
      detail: "root export should be ./src/index.ts",
      path: manifest,
    });
});
