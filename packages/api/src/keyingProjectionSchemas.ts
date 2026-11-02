import type { KeyingCanonicalJson } from "@tearleads/crypto";
import { isKeyingCanonicalJson } from "@tearleads/crypto";
import { isPlainObject } from "@tearleads/validators/isPlainObject";
import { z } from "zod";

/**
 * Zod building blocks for keying projection records: signed or stored
 * material read back from requests and the database before it is verified.
 * `parseProjection` reports the first issue as `${label}.field is invalid`
 * (`[index]` for list entries), the message every caller and client sees.
 */

export type ProjectionErrorFactory = (message: string) => Error;

/** A plain object: `Object.prototype` or a null prototype. */
export const projectionPlainRecord =
  z.custom<Record<string, unknown>>(isPlainObject);

export const projectionString = z.string().min(1);

/** Present, and either null or a string (empty allowed). */
export const projectionNullableString = z.string().nullable();

/**
 * `Number.isInteger` and positive. Unlike `z.int()`, this keeps integers
 * beyond the safe range, which these readers have always accepted.
 */
export const projectionPositiveInteger = z
  .number()
  .refine((value) => Number.isInteger(value) && value > 0);

export const projectionVersion = z.literal(1);

/** Canonical JSON, passed through as the original value. */
export const projectionCanonicalJson = z.custom<KeyingCanonicalJson>(
  isKeyingCanonicalJson,
);

const stringList = z.array(z.string());

/** A list of strings; a bad entry is reported against the list itself. */
export const projectionStringArray = z
  .custom<string[]>((value) => stringList.safeParse(value).success)
  .pipe(stringList);

/** Replaces the default "is invalid" suffix of a custom issue. */
export function projectionIssue(message: string) {
  return { params: { projectionMessage: message } };
}

/**
 * A plain record rebuilt with exactly `shape`'s keys, in `shape`'s order.
 * Keys in `checkedFirst` are checked, in that order, before the rest, so a
 * record failing several fields reports the same one it always has.
 */
export function projectionRecord<const Shape extends z.ZodRawShape>(
  shape: Shape,
  checkedFirst: readonly (keyof Shape & string)[] = [],
) {
  const checkedFirstRecord: z.ZodType<
    Record<string, unknown>,
    Record<string, unknown>
  > = z.looseObject(
    Object.fromEntries(checkedFirst.map((key) => [key, shape[key]])),
  );
  return projectionPlainRecord.pipe(checkedFirstRecord).pipe(z.object(shape));
}

function issuePath(path: readonly PropertyKey[]): string {
  return path
    .map((segment) =>
      typeof segment === "number" ? `[${segment}]` : `.${String(segment)}`,
    )
    .join("");
}

function issueSuffix(issue: z.core.$ZodIssue): string {
  const { projectionMessage } =
    (issue.code === "custom" ? issue.params : undefined) ?? {};
  return typeof projectionMessage === "string"
    ? projectionMessage
    : "is invalid";
}

export function parseProjection<Schema extends z.ZodType>(
  schema: Schema,
  value: unknown,
  label: string,
  error: ProjectionErrorFactory,
): z.output<Schema> {
  const result = schema.safeParse(value);
  if (result.success) {
    return result.data;
  }
  const [issue] = result.error.issues;
  throw error(
    issue
      ? `${label}${issuePath(issue.path)} ${issueSuffix(issue)}`
      : `${label} is invalid`,
  );
}

/** A shallow copy of a plain record, for responses built from stored JSON. */
export function copyProjectionRecord(
  value: unknown,
  label: string,
  error: ProjectionErrorFactory,
): Record<string, unknown> {
  return { ...parseProjection(projectionPlainRecord, value, label, error) };
}
