import type { z } from "zod";
import { toJsonSchemaProjection } from "../jsonSchema";
import type { HttpOperation } from "./definition";

const propertyNamesBySchema = new WeakMap<z.ZodType, readonly string[]>();

function objectSchemaPropertyNames(
  operation: HttpOperation,
  schema: z.ZodType,
  label: string,
): readonly string[] {
  const cached = propertyNamesBySchema.get(schema);
  if (cached) {
    return cached;
  }

  const projected = toJsonSchemaProjection(schema).jsonSchema;
  if (projected.type !== "object" || projected.properties === undefined) {
    throw new TypeError(`${operation.id} ${label} must be an object schema`);
  }

  const names = Object.freeze(Object.keys(projected.properties));
  propertyNamesBySchema.set(schema, names);
  return names;
}

export function operationRequestHeaderNames(
  operation: HttpOperation,
): readonly string[] {
  return operation.headers
    ? objectSchemaPropertyNames(operation, operation.headers, "request headers")
    : [];
}

export function operationResponseHeaderNames(
  operation: HttpOperation,
  status?: number,
): readonly string[] {
  if (status === undefined) {
    return [
      ...new Set(
        Object.keys(operation.responseHeaders ?? {}).flatMap((responseStatus) =>
          operationResponseHeaderNames(operation, Number(responseStatus)),
        ),
      ),
    ];
  }
  const schema = operation.responseHeaders?.[status];
  return schema
    ? objectSchemaPropertyNames(operation, schema, `response ${status} headers`)
    : [];
}
