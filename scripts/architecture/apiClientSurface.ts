import { readFile } from "node:fs/promises";
import { join } from "node:path";
import * as ts from "typescript";

export const apiClientPackageJsonPath = "packages/api-client/package.json";
export const apiClientIndexPath = "packages/api-client/src/index.ts";

const apiClientPackageExports = { ".": "./src/index.ts" } as const;

/**
 * Everything @tearleads/api-client publishes: the client, the results and
 * failures its requests report, the options and ports its methods take,
 * reachability, request metrics, and the server-events socket. Wire shapes,
 * protocol types and their pure checks live in @tearleads/validators or
 * @tearleads/crypto, and consumers import them from there (#3123). Add a name
 * only when it is part of the transport itself.
 */
export const apiClientRootExports: readonly string[] = [
  // The client.
  "ApiClient",
  // Request results and failures.
  "AccountSuspendedError",
  "ApiNetworkError",
  "ApiNetworkFailureClass",
  "ApiNetworkFailureDetails",
  "RequestFailure",
  "RequestFailureKind",
  "RequestResult",
  "RequestSuccess",
  // Options, positions and ports that client methods take, and what they return.
  "BlobBytesResponse",
  "BlobDownloadOptions",
  "HttpMethod",
  "ListDocumentEditAttributionRangesOptions",
  "PrincipalPolicyDiscoveryOptions",
  "PrincipalPolicyHeldHead",
  "PrincipalPolicyPageReadOptions",
  "PrincipalPolicyPageResume",
  "ProjectionPolicyHistoryReadOptions",
  "RequestResultOptions",
  "UploadMultipartBlobPartBytesRequest",
  "VerifiedManifestCitations",
  // The part description a multipart upload's signed URLs bind.
  "describeMultipartBlobPart",
  // Reachability, request metrics and the server-events socket.
  "ApiReachability",
  "ApiReachabilityProbe",
  "createApiReachabilityProbe",
  "ApiRequestCounts",
  "ApiRequestEndpointCounts",
  "ApiRequestMetrics",
  "ApiRequestMetricsSnapshot",
  "openServerEventsSocket",
];

export interface ApiClientSurfaceViolation {
  readonly detail: string;
  readonly path: string;
}

function hasModifier(statement: ts.Statement, kind: ts.SyntaxKind): boolean {
  return (
    ts.canHaveModifiers(statement) &&
    (ts.getModifiers(statement) ?? []).some(
      (modifier) => modifier.kind === kind,
    )
  );
}

/** Every name a binding introduces, including each one a pattern destructures. */
function boundNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((element) =>
    ts.isBindingElement(element) ? boundNames(element.name) : [],
  );
}

function declaredNames(statement: ts.Statement): string[] {
  // `export default class Foo` exports `default`, not `Foo`.
  if (hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) return ["default"];
  if (ts.isVariableStatement(statement))
    return statement.declarationList.declarations.flatMap((declaration) =>
      boundNames(declaration.name),
    );
  const name = (statement as { readonly name?: ts.Node }).name;
  return name && ts.isIdentifier(name) ? [name.text] : ["default"];
}

/** Each name an entry module exports, or a violation for a wildcard re-export. */
function readEntryExports(source: string) {
  const file = ts.createSourceFile(
    apiClientIndexPath,
    source,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TS,
  );
  const names: string[] = [];
  const wildcards: string[] = [];
  for (const statement of file.statements) {
    if (ts.isExportDeclaration(statement)) {
      const clause = statement.exportClause;
      if (clause && ts.isNamedExports(clause))
        names.push(...clause.elements.map((element) => element.name.text));
      else wildcards.push(statement.getText(file));
    } else if (ts.isExportAssignment(statement)) names.push("default");
    else if (hasModifier(statement, ts.SyntaxKind.ExportKeyword))
      names.push(...declaredNames(statement));
  }
  return { names, wildcards };
}

/**
 * Violations of an exact export list: a wildcard re-export, a name outside
 * `allowed`, or an allowed name the entry no longer exports.
 */
export function findEntryExportViolations(
  source: string,
  allowed: readonly string[],
): ApiClientSurfaceViolation[] {
  const { names, wildcards } = readEntryExports(source);
  const exported = new Set(names);
  const permitted = new Set(allowed);
  return [
    ...wildcards.map((statement) => ({
      detail: `re-exports a whole module (${statement}); export names explicitly`,
      path: apiClientIndexPath,
    })),
    ...names
      .filter((name) => !permitted.has(name))
      .map((name) => ({
        detail: `exports ${name}, which is not part of the transport surface`,
        path: apiClientIndexPath,
      })),
    ...allowed
      .filter((name) => !exported.has(name))
      .map((name) => ({
        detail: `no longer exports ${name}; remove it from apiClientRootExports`,
        path: apiClientIndexPath,
      })),
  ];
}

/** Violations unless the package's only entry point is its root index. */
export function findPackageExportViolations(
  packageJson: unknown,
): ApiClientSurfaceViolation[] {
  const exports =
    typeof packageJson === "object" && packageJson !== null
      ? Reflect.get(packageJson, "exports")
      : undefined;
  const entries: [string, unknown][] =
    typeof exports === "object" && exports !== null
      ? Object.entries(exports)
      : [];
  const violations = entries
    .filter(([path]) => !Object.hasOwn(apiClientPackageExports, path))
    .map(([path]) => ({
      detail: `exports subpath ${path}; publish only the root entry point`,
      path: apiClientPackageJsonPath,
    }));
  const root = entries.find(([path]) => path === ".")?.[1];
  if (root !== apiClientPackageExports["."])
    violations.push({
      detail: `root export should be ${apiClientPackageExports["."]}`,
      path: apiClientPackageJsonPath,
    });
  return violations;
}

/** Surface violations in the checkout at `root`, the repository root. */
export async function findApiClientSurfaceViolations(
  root = ".",
): Promise<ApiClientSurfaceViolation[]> {
  const [packageJson, index] = await Promise.all([
    readFile(join(root, apiClientPackageJsonPath), "utf8"),
    readFile(join(root, apiClientIndexPath), "utf8"),
  ]);
  return [
    ...findPackageExportViolations(JSON.parse(packageJson)),
    ...findEntryExportViolations(index, apiClientRootExports),
  ];
}
