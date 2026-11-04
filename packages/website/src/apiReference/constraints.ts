import type { JsonRecord } from "./json";

/**
 * JSON Schema constraints in words: "1 to 64 characters", "at most 500
 * items", "one of `admin`, `member`". Each phrase is a list of inline parts so
 * values and patterns render as code.
 */

export type InlinePart =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "code"; readonly text: string }
  | { readonly kind: "schema"; readonly name: string };

export type Inline = readonly InlinePart[];

export function text(value: string): InlinePart {
  return { kind: "text", text: value };
}

function code(value: string): InlinePart {
  return { kind: "code", text: value };
}

function formatNumber(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 20 });
}

function plural(count: number, unit: string): string {
  return `${formatNumber(count)} ${unit}${count === 1 ? "" : "s"}`;
}

function readNumber(schema: JsonRecord, key: string): number | undefined {
  const value = schema[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number") throw new Error(`${key}: expected a number`);
  return value;
}

/** "1 to 64 characters", "at least 1 item", "exactly 64 characters". */
function sizeRange(
  min: number | undefined,
  max: number | undefined,
  unit: string,
): Inline | null {
  if (min !== undefined && max !== undefined) {
    return min === max
      ? [text(`exactly ${plural(max, unit)}`)]
      : [text(`${formatNumber(min)} to ${plural(max, unit)}`)];
  }
  if (min !== undefined && min > 0) {
    if (min === 1 && unit === "character") return [text("not empty")];
    return [text(`at least ${plural(min, unit)}`)];
  }
  if (max !== undefined) return [text(`at most ${plural(max, unit)}`)];
  return null;
}

export function lengthConstraint(schema: JsonRecord): Inline | null {
  return sizeRange(
    readNumber(schema, "minLength"),
    readNumber(schema, "maxLength"),
    "character",
  );
}

export function itemCountConstraint(schema: JsonRecord): Inline | null {
  return sizeRange(
    readNumber(schema, "minItems"),
    readNumber(schema, "maxItems"),
    "item",
  );
}

/**
 * Zod writes the safe-integer and float limits as bounds on every number;
 * they say nothing a reader needs, so they are left out.
 */
function meaningfulBound(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  return Math.abs(value) >= Number.MAX_SAFE_INTEGER ? undefined : value;
}

export function numberConstraints(schema: JsonRecord): Inline[] {
  const min = meaningfulBound(readNumber(schema, "minimum"));
  const max = meaningfulBound(readNumber(schema, "maximum"));
  const above = meaningfulBound(readNumber(schema, "exclusiveMinimum"));
  const below = meaningfulBound(readNumber(schema, "exclusiveMaximum"));
  const phrases: Inline[] = [];
  if (min !== undefined && max !== undefined) {
    phrases.push([text(`${formatNumber(min)} to ${formatNumber(max)}`)]);
  } else if (min !== undefined) {
    phrases.push([text(`at least ${formatNumber(min)}`)]);
  } else if (max !== undefined) {
    phrases.push([text(`at most ${formatNumber(max)}`)]);
  }
  if (above !== undefined) {
    phrases.push([text(`greater than ${formatNumber(above)}`)]);
  }
  if (below !== undefined) {
    phrases.push([text(`less than ${formatNumber(below)}`)]);
  }
  return phrases;
}

/** A JSON literal as code: strings without quotes, everything else as JSON. */
export function literal(value: unknown): InlinePart {
  return code(typeof value === "string" ? value : JSON.stringify(value));
}

/** ["one of ", `a`, ", ", `b`] */
export function oneOfLiterals(
  lead: string,
  values: readonly unknown[],
): Inline {
  const parts: InlinePart[] = [text(lead)];
  values.forEach((value, index) => {
    if (index > 0) parts.push(text(", "));
    parts.push(literal(value));
  });
  return parts;
}

const namedPatterns = new Map([
  [
    "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    "lowercase UUID v4",
  ],
  [
    "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$",
    "UUID",
  ],
  ["^[0-9a-f]+$", "lowercase hexadecimal"],
  ["^[0-9]+$", "decimal digits"],
  ["^https?:\\/\\/", "an http or https URL"],
]);

/** The alphabet of a pattern built from base64 or base64url groups. */
function alphabetName(pattern: string): string | undefined {
  if (/^\^(?:\(\?:)?\[A-Za-z0-9\+\/\]/.test(pattern)) return "base64";
  if (/^\^(?:\(\?:)?\[A-Za-z0-9_-\]/.test(pattern)) return "base64url";
  return undefined;
}

/**
 * A pattern the name states exactly ("lowercase UUID v4") is shown by name;
 * any other is shown as code, after its alphabet when that is recognizable.
 */
export function patternConstraint(pattern: string): Inline {
  const named = namedPatterns.get(pattern);
  if (named !== undefined) return [text(named)];
  const alphabet = alphabetName(pattern);
  return alphabet === undefined
    ? [text("pattern "), code(pattern)]
    : [text(`${alphabet}, pattern `), code(pattern)];
}

const formatNames = new Map([
  ["date-time", "an ISO 8601 date and time"],
  ["binary", "raw bytes"],
]);

export function formatConstraint(format: string): Inline {
  const name = formatNames.get(format);
  if (name === undefined) throw new Error(`format: unsupported "${format}"`);
  return [text(name)];
}
