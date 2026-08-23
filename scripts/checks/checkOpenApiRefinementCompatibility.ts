/**
 * Fail when a revision spec changes an operation contract in a direction that
 * existing clients can observe but the pinned oasdiff does not detect.
 *
 * oasdiff ignores x-symcrypt-runtime-refinements, so these server-side rules
 * invisible to the JSON Schema would otherwise change with a green
 * compatibility check. Direction depends on which side a refinement
 * constrains: adding or rewording a `request.` refinement rejects previously
 * valid client requests, while removing or rewording a `response.` refinement
 * lets the server emit responses old clients still validate against the
 * refinement and reject. Removing a request refinement or adding a response
 * refinement loosens or narrows compatibly and is allowed, as is anything on
 * an operation that does not exist in the base. Ids with any other prefix
 * fail on every change until they are classified.
 *
 * The custom checks cover runtime-refinement direction and request maxItems
 * tightenings. Usage:
 * bun checkOpenApiRefinementCompatibility.ts <base.json> <revision.json> [ignore-file]
 * Set OPENAPI_ALLOW_REFINEMENT_TIGHTENING=1 to acknowledge an intentional
 * breaking change and let the check pass loudly.
 */

import { createHash } from "node:crypto";
import process from "node:process";

const REFINEMENTS_KEY = "x-symcrypt-runtime-refinements";

const HTTP_METHODS = new Set([
  "delete",
  "get",
  "head",
  "options",
  "patch",
  "post",
  "put",
  "trace",
]);

interface Refinement {
  readonly description: string;
  readonly id: string;
}

type RefinementsByOperation = Map<string, Map<string, string>>;
type RequestSchemaNodesByOperation = Map<string, Map<string, number | null>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRefinement(value: unknown): value is Refinement {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Refinement).id === "string" &&
    typeof (value as Refinement).description === "string"
  );
}

function operationRefinements(
  operation: object,
  label: string,
): Map<string, string> {
  const byId = new Map<string, string>();
  const { [REFINEMENTS_KEY]: refinements } = operation as Record<
    string,
    unknown
  >;
  if (refinements === undefined) {
    return byId;
  }
  if (!Array.isArray(refinements) || !refinements.every(isRefinement)) {
    throw new Error(`${label} has a malformed ${REFINEMENTS_KEY} array.`);
  }
  for (const refinement of refinements) {
    if (byId.has(refinement.id)) {
      throw new Error(`${label} declares refinement '${refinement.id}' twice.`);
    }
    byId.set(refinement.id, refinement.description);
  }
  return byId;
}

function collectRefinements(
  spec: unknown,
  source: string,
): RefinementsByOperation {
  if (typeof spec !== "object" || spec === null) {
    throw new Error(`${source} is not a JSON object.`);
  }
  const { paths } = spec as { paths?: unknown };
  const collected: RefinementsByOperation = new Map();
  if (typeof paths !== "object" || paths === null) {
    return collected;
  }
  for (const [path, operations] of Object.entries(paths)) {
    if (typeof operations !== "object" || operations === null) {
      continue;
    }
    for (const [method, operation] of Object.entries(operations)) {
      const isOperation =
        HTTP_METHODS.has(method) &&
        typeof operation === "object" &&
        operation !== null;
      if (!isOperation) {
        continue;
      }
      const key = `${method.toUpperCase()} ${path}`;
      collected.set(key, operationRefinements(operation, `${source}: ${key}`));
    }
  }
  return collected;
}

function escapeJsonPointerToken(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function collectRequestSchemaNodes(
  value: unknown,
  pointer: string,
  nodes: Map<string, number | null>,
): void {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      collectRequestSchemaNodes(item, `${pointer}/${index}`, nodes);
    }
    return;
  }
  if (!isRecord(value)) {
    return;
  }

  const maxItems = Reflect.get(value, "maxItems");
  nodes.set(pointer, typeof maxItems === "number" ? maxItems : null);
  for (const [key, child] of Object.entries(value)) {
    if (key === "maxItems") {
      continue;
    }
    collectRequestSchemaNodes(
      child,
      `${pointer}/${escapeJsonPointerToken(key)}`,
      nodes,
    );
  }
}

function jsonRequestSchema(operation: Record<string, unknown>): unknown {
  const requestBody = Reflect.get(operation, "requestBody");
  const content = isRecord(requestBody)
    ? Reflect.get(requestBody, "content")
    : undefined;
  const jsonContent = isRecord(content)
    ? content["application/json"]
    : undefined;
  return isRecord(jsonContent) ? Reflect.get(jsonContent, "schema") : undefined;
}

function collectRequestMaxItems(spec: unknown): RequestSchemaNodesByOperation {
  const collected: RequestSchemaNodesByOperation = new Map();
  if (!isRecord(spec)) {
    return collected;
  }
  const paths = Reflect.get(spec, "paths");
  if (!isRecord(paths)) {
    return collected;
  }
  for (const [path, operations] of Object.entries(paths)) {
    if (!isRecord(operations)) {
      continue;
    }
    for (const [method, operation] of Object.entries(operations)) {
      if (!HTTP_METHODS.has(method) || !isRecord(operation)) {
        continue;
      }
      const schema = jsonRequestSchema(operation);
      if (schema === undefined) {
        continue;
      }
      const nodes = new Map<string, number | null>();
      collectRequestSchemaNodes(schema, "#", nodes);
      collected.set(`${method.toUpperCase()} ${path}`, nodes);
    }
  }
  return collected;
}

async function loadSpec(filePath: string): Promise<unknown> {
  return JSON.parse(await Bun.file(filePath).text());
}

async function loadIgnoredViolations(filePath: string): Promise<string[]> {
  const entries = (await Bun.file(filePath).text())
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  if (new Set(entries).size !== entries.length) {
    throw new Error(`${filePath} repeats a runtime-refinement ignore entry.`);
  }
  return entries;
}

function addedRefinementViolation(
  operation: string,
  id: string,
): string | null {
  if (id.startsWith("response.")) {
    return null;
  }
  if (id.startsWith("request.")) {
    return `${operation}: request refinement '${id}' was added; existing clients were not rejected by it.`;
  }
  return `${operation}: refinement '${id}' has no request./response. prefix; classify it before changing it.`;
}

function removedRefinementViolation(
  operation: string,
  id: string,
): string | null {
  if (id.startsWith("request.")) {
    return null;
  }
  if (id.startsWith("response.")) {
    return `${operation}: response refinement '${id}' was removed; existing clients still validate responses against it.`;
  }
  return `${operation}: refinement '${id}' has no request./response. prefix; classify it before changing it.`;
}

function operationViolations(
  operation: string,
  baseRefinements: ReadonlyMap<string, string>,
  revisionRefinements: ReadonlyMap<string, string>,
): string[] {
  const violations: string[] = [];
  for (const [id, description] of [...revisionRefinements.entries()].sort()) {
    const baseDescription = baseRefinements.get(id);
    if (baseDescription === undefined) {
      const violation = addedRefinementViolation(operation, id);
      if (violation !== null) {
        violations.push(violation);
      }
    } else if (baseDescription !== description) {
      violations.push(
        `${operation}: refinement '${id}' was reworded; treat semantic changes as breaking.`,
      );
    }
  }
  for (const id of [...baseRefinements.keys()].sort()) {
    if (revisionRefinements.has(id)) {
      continue;
    }
    const violation = removedRefinementViolation(operation, id);
    if (violation !== null) {
      violations.push(violation);
    }
  }
  return violations;
}

function collectViolations(
  base: RefinementsByOperation,
  revision: RefinementsByOperation,
): string[] {
  const violations: string[] = [];
  for (const [operation, revisionRefinements] of [
    ...revision.entries(),
  ].sort()) {
    const baseRefinements = base.get(operation);
    if (baseRefinements === undefined) {
      continue;
    }
    violations.push(
      ...operationViolations(operation, baseRefinements, revisionRefinements),
    );
  }
  return violations;
}

function collectRequestMaxItemsViolations(
  base: RequestSchemaNodesByOperation,
  revision: RequestSchemaNodesByOperation,
): string[] {
  const violations: string[] = [];
  for (const [operation, revisionNodes] of [...revision.entries()].sort()) {
    const baseNodes = base.get(operation);
    if (baseNodes === undefined) {
      continue;
    }
    const operationChanges: string[] = [];
    for (const [pointer, revisionMaxItems] of [
      ...revisionNodes.entries(),
    ].sort()) {
      if (revisionMaxItems === null || !baseNodes.has(pointer)) {
        continue;
      }
      const baseMaxItems = baseNodes.get(pointer);
      if (baseMaxItems === null) {
        operationChanges.push(`${pointer}:unbounded->${revisionMaxItems}`);
      } else if (
        baseMaxItems !== undefined &&
        revisionMaxItems < baseMaxItems
      ) {
        operationChanges.push(
          `${pointer}:${baseMaxItems}->${revisionMaxItems}`,
        );
      }
    }
    if (operationChanges.length > 0) {
      const digest = createHash("sha256")
        .update(operationChanges.join("\n"))
        .digest("hex");
      violations.push(
        `${operation}: ${operationChanges.length} request maxItems constraint(s) tightened [sha256:${digest}]; existing clients could send larger arrays.`,
      );
    }
  }
  return violations;
}

async function main(): Promise<number> {
  const [basePath, revisionPath, ignorePath] = Bun.argv.slice(2);
  if (basePath === undefined || revisionPath === undefined) {
    console.error(
      "Usage: bun checkOpenApiRefinementCompatibility.ts <base.json> <revision.json> [ignore-file]",
    );
    return 2;
  }

  const baseSpec = await loadSpec(basePath);
  const revisionSpec = await loadSpec(revisionPath);
  const base = collectRefinements(baseSpec, "base spec");
  const revision = collectRefinements(revisionSpec, "revision spec");
  const violations = [
    ...collectViolations(base, revision),
    ...collectRequestMaxItemsViolations(
      collectRequestMaxItems(baseSpec),
      collectRequestMaxItems(revisionSpec),
    ),
  ].sort();
  const ignoredViolations =
    ignorePath === undefined ? [] : await loadIgnoredViolations(ignorePath);
  const unusedIgnores = ignoredViolations.filter(
    (ignored) => !violations.includes(ignored),
  );
  if (unusedIgnores.length > 0) {
    for (const unused of unusedIgnores) {
      console.error(
        `unused custom OpenAPI compatibility ignore entry: ${unused}`,
      );
    }
    return 1;
  }
  const ignoredSet = new Set(ignoredViolations);
  const unignoredViolations = violations.filter(
    (violation) => !ignoredSet.has(violation),
  );
  for (const ignored of ignoredViolations) {
    console.warn(`Ignored intentional custom compatibility change: ${ignored}`);
  }
  if (unignoredViolations.length === 0) {
    return 0;
  }

  const heading = `${unignoredViolations.length} breaking custom OpenAPI compatibility change(s) not visible to oasdiff:`;
  const { OPENAPI_ALLOW_REFINEMENT_TIGHTENING: allowTightening } = process.env;
  if (allowTightening === "1") {
    console.warn(
      `Allowed by OPENAPI_ALLOW_REFINEMENT_TIGHTENING=1 — ${heading}`,
    );
    for (const violation of unignoredViolations) {
      console.warn(`  ${violation}`);
    }
    return 0;
  }

  console.error(heading);
  for (const violation of unignoredViolations) {
    console.error(`  ${violation}`);
  }
  console.error(
    "Tightening request refinements or loosening response refinements breaks existing clients. " +
      "Coordinate the rollout, then set OPENAPI_ALLOW_REFINEMENT_TIGHTENING=1 for the intentional change.",
  );
  return 1;
}

if (import.meta.main) {
  process.exitCode = await main();
}
