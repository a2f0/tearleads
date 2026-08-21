/**
 * Fail when a revision spec changes an operation's runtime refinements in a
 * direction existing clients can observe as breaking.
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
 * Usage: bun checkOpenApiRefinementCompatibility.ts <base.json> <revision.json>
 * Set OPENAPI_ALLOW_REFINEMENT_TIGHTENING=1 to acknowledge an intentional
 * breaking change and let the check pass loudly.
 */

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

async function loadSpec(filePath: string): Promise<unknown> {
  return JSON.parse(await Bun.file(filePath).text());
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

async function main(): Promise<number> {
  const [basePath, revisionPath] = Bun.argv.slice(2);
  if (basePath === undefined || revisionPath === undefined) {
    console.error(
      "Usage: bun checkOpenApiRefinementCompatibility.ts <base.json> <revision.json>",
    );
    return 2;
  }

  const base = collectRefinements(await loadSpec(basePath), "base spec");
  const revision = collectRefinements(
    await loadSpec(revisionPath),
    "revision spec",
  );
  const violations = collectViolations(base, revision);
  if (violations.length === 0) {
    return 0;
  }

  const heading = `${violations.length} breaking runtime-refinement change(s) not visible to oasdiff:`;
  const { OPENAPI_ALLOW_REFINEMENT_TIGHTENING: allowTightening } = process.env;
  if (allowTightening === "1") {
    console.warn(
      `Allowed by OPENAPI_ALLOW_REFINEMENT_TIGHTENING=1 — ${heading}`,
    );
    for (const violation of violations) {
      console.warn(`  ${violation}`);
    }
    return 0;
  }

  console.error(heading);
  for (const violation of violations) {
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
