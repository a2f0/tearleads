import {
  formatConstraint,
  type Inline,
  type InlinePart,
  itemCountConstraint,
  lengthConstraint,
  literal,
  numberConstraints,
  oneOfLiterals,
  patternConstraint,
  text,
} from "./constraints";
import {
  isRecord,
  type JsonRecord,
  readArray,
  readOptionalString,
  readString,
  readStringArray,
} from "./json";
import type { JsonSchema } from "./openApiDocument";
import type { RichText, TextRenderer } from "./richText";

/**
 * Turns a JSON Schema from docs/openapi.json into a nested field list for
 * people: a readable type ("list of ContainerManifest", "map of string to
 * X"), nullability, constraints in words, the description, and the fields of
 * inline objects. A `$ref` stays a link to its schema page.
 *
 * Every keyword a node carries must be consumed by the branch that handles
 * it, so a keyword this renderer does not present (or presents only in
 * another context) throws instead of rendering wrong.
 */

export interface Field {
  readonly name: string;
  readonly required: boolean;
  readonly shape: Shape;
}

export interface Shape {
  readonly type: Inline;
  readonly nullable: boolean;
  readonly constraints: readonly Inline[];
  readonly description: RichText;
  /** Members of an inline object (or of a list's or map's inline values). */
  readonly fields: readonly Field[];
  /** The alternatives of a `oneOf`/`anyOf` that are not just literals. */
  readonly variants: readonly Shape[];
  /** The object accepts fields beyond those listed. */
  readonly otherFields: boolean;
}

/** Every JSON Schema keyword the renderer presents. */
export const handledKeywords: ReadonlySet<string> = new Set([
  "$ref",
  "additionalProperties",
  "anyOf",
  "const",
  "description",
  "enum",
  "exclusiveMaximum",
  "exclusiveMinimum",
  "format",
  "items",
  "maxItems",
  "maxLength",
  "maximum",
  "minItems",
  "minLength",
  "minimum",
  "not",
  "oneOf",
  "pattern",
  "properties",
  "propertyNames",
  "required",
  "type",
  "x-extensible-enum",
]);

const componentPrefix = "#/components/schemas/";

function plain(type: Inline, constraints: readonly Inline[] = []): Shape {
  return {
    type,
    nullable: false,
    constraints,
    description: [],
    fields: [],
    variants: [],
    otherFields: false,
  };
}

/** The component a `{ "$ref": ... }` schema names, if that is all it is. */
export function refName(schema: JsonSchema): string | undefined {
  if (!isRecord(schema) || typeof schema.$ref !== "string") return undefined;
  if (!schema.$ref.startsWith(componentPrefix)) {
    throw new Error(`Unsupported $ref ${schema.$ref}`);
  }
  return schema.$ref.slice(componentPrefix.length);
}

/** Tracks which keywords a node's branch has consumed. */
class SchemaNode {
  readonly #schema: JsonRecord;
  readonly #used = new Set<string>();
  readonly where: string;

  constructor(schema: JsonRecord, where: string) {
    this.#schema = schema;
    this.where = where;
  }

  has(key: string): boolean {
    return this.#schema[key] !== undefined;
  }

  take(key: string): unknown {
    this.#used.add(key);
    return this.#schema[key];
  }

  finish(): void {
    for (const key of Object.keys(this.#schema)) {
      if (this.#used.has(key)) continue;
      const kind = handledKeywords.has(key) ? "here" : "anywhere";
      throw new Error(
        `${this.where}: the API reference does not render JSON Schema keyword "${key}" ${kind}`,
      );
    }
  }
}

export class SchemaDescriber {
  readonly #render: TextRenderer;

  constructor(render: TextRenderer) {
    this.#render = render;
  }

  describe(schema: JsonSchema, where: string): Shape {
    if (schema === true) return plain([text("any JSON value")]);
    if (schema === false) return plain([text("never present")]);
    const node = new SchemaNode(schema, where);
    const description = this.#render(
      readOptionalString(node.take("description"), `${where}.description`),
    );
    const shape = this.#body(node);
    node.finish();
    return { ...shape, description: [...description, ...shape.description] };
  }

  #body(node: SchemaNode): Shape {
    if (node.has("$ref")) {
      const name = refName({ $ref: node.take("$ref") });
      return plain([{ kind: "schema", name: name ?? "" }]);
    }
    if (node.has("anyOf") || node.has("oneOf")) return this.#union(node);
    const excluded = this.#excluded(node);
    if (excluded === "absent") return plain([text("never present")]);
    const shape = this.#typed(node);
    return excluded === undefined
      ? shape
      : { ...shape, constraints: [...shape.constraints, excluded] };
  }

  /** `not: {}` (the field must be absent) or `not: { const }`. */
  #excluded(node: SchemaNode): Inline | "absent" | undefined {
    const not = node.take("not");
    if (not === undefined) return undefined;
    if (isRecord(not) && Object.keys(not).length === 0) return "absent";
    if (isRecord(not) && Object.keys(not).join() === "const") {
      return [text("not "), literal(not.const)];
    }
    throw new Error(`${node.where}.not: only {} and { const } are rendered`);
  }

  #union(node: SchemaNode): Shape {
    const key = node.has("anyOf") ? "anyOf" : "oneOf";
    const options = readArray(node.take(key), `${node.where}.${key}`);
    const isNull = (option: unknown) =>
      isRecord(option) &&
      Object.keys(option).join() === "type" &&
      option.type === "null";
    const rest = options.filter((option) => !isNull(option));
    const nullable = rest.length < options.length;
    const schemas = rest.map((option, index) => {
      if (typeof option === "boolean" || isRecord(option)) return option;
      throw new Error(`${node.where}.${key}[${index}]: expected a schema`);
    });
    const [only] = schemas;
    if (schemas.length === 1 && only !== undefined) {
      return { ...this.describe(only, `${node.where}.${key}[0]`), nullable };
    }
    const literals = schemas.map(literalValue);
    if (literals.every((value) => value !== undefined)) {
      const kind = literals.every((value) => typeof value === "string")
        ? "string"
        : "value";
      return {
        ...plain([text(kind)], [oneOfLiterals("one of ", literals)]),
        nullable,
      };
    }
    const variants = schemas.map((option, index) =>
      this.describe(option, `${node.where}.${key}[${index}]`),
    );
    const type: InlinePart[] = [text("one of: ")];
    variants.forEach((variant, index) => {
      if (index > 0) type.push(text(", "));
      type.push(...variant.type);
    });
    return { ...plain(type), nullable, variants };
  }

  #typed(node: SchemaNode): Shape {
    const type = node.take("type");
    const literals = literalConstraints(node);
    switch (type) {
      case "string": {
        const binary = node.take("format") === "binary";
        const constraints = [...literals, ...stringConstraints(node)];
        return plain([text(binary ? "bytes" : "string")], constraints);
      }
      case "integer":
      case "number":
        return plain(
          [text(type)],
          [...literals, ...numberConstraints(take(node, numberKeys))],
        );
      case "boolean":
      case "null":
        return plain([text(type)], literals);
      case "array":
        return this.#array(node, literals);
      case "object":
        return this.#object(node, literals);
      case undefined:
        return plain(
          [text(literals.length > 0 ? "value" : "any JSON value")],
          literals,
        );
      default:
        throw new Error(
          `${node.where}.type: unsupported ${JSON.stringify(type)}`,
        );
    }
  }

  #array(node: SchemaNode, literals: readonly Inline[]): Shape {
    const items = node.take("items");
    const item =
      items === undefined
        ? plain([text("any JSON value")])
        : this.describe(
            schemaValue(items, `${node.where}.items`),
            `${node.where}[]`,
          );
    const count = itemCountConstraint(take(node, ["minItems", "maxItems"]));
    const constraints = [
      ...literals,
      ...(count === null ? [] : [count]),
      ...(item.nullable ? [[text("each item may be null")]] : []),
      ...item.constraints.map((phrase) => [text("each item: "), ...phrase]),
    ];
    return {
      ...item,
      type: [text("list of "), ...item.type],
      nullable: false,
      constraints,
    };
  }

  #object(node: SchemaNode, literals: readonly Inline[]): Shape {
    const where = node.where;
    const properties = node.take("properties");
    const required = new Set(
      node.has("required")
        ? readStringArray(node.take("required"), `${where}.required`)
        : [],
    );
    const additional = node.take("additionalProperties");
    const entries =
      properties === undefined
        ? []
        : Object.entries(recordValue(properties, `${where}.properties`));
    if (entries.length === 0)
      return this.#map(node, additional, required, literals);
    for (const name of required) {
      if (!entries.some(([key]) => key === name)) {
        throw new Error(`${where}.required: ${name} is not a property`);
      }
    }
    const fields = entries.map(([name, schema]) => ({
      name,
      required: required.has(name),
      shape: this.describe(
        schemaValue(schema, `${where}.${name}`),
        `${where}.${name}`,
      ),
    }));
    if (
      additional !== undefined &&
      additional !== false &&
      !isAnySchema(additional)
    ) {
      throw new Error(
        `${where}.additionalProperties: typed extra fields beside listed ones are not rendered`,
      );
    }
    return {
      ...plain([text("object")], literals),
      fields,
      // JSON Schema allows unlisted fields unless additionalProperties is false.
      otherFields: additional !== false,
    };
  }

  /** An object without listed fields: empty, open, or a map. */
  #map(
    node: SchemaNode,
    additional: unknown,
    required: ReadonlySet<string>,
    literals: readonly Inline[],
  ): Shape {
    if (required.size > 0) {
      throw new Error(`${node.where}.required: no properties to require`);
    }
    const names = node.take("propertyNames");
    if (additional === false) return plain([text("empty object")], literals);
    if (additional === undefined || isAnySchema(additional)) {
      if (names !== undefined) {
        throw new Error(`${node.where}.propertyNames: needs a value schema`);
      }
      return plain([text("object with any fields")], literals);
    }
    const key =
      names === undefined
        ? plain([text("string")])
        : this.describe(
            schemaValue(names, `${node.where}.propertyNames`),
            `${node.where}{key}`,
          );
    const value = this.describe(
      schemaValue(additional, `${node.where}.additionalProperties`),
      `${node.where}{}`,
    );
    return {
      ...value,
      type: [text("map of "), ...key.type, text(" to "), ...value.type],
      nullable: false,
      constraints: [
        ...literals,
        ...key.constraints.map((phrase) => [text("each key: "), ...phrase]),
        ...(value.nullable ? [[text("each value may be null")]] : []),
        ...value.constraints.map((phrase) => [text("each value: "), ...phrase]),
      ],
      description: [...key.description, ...value.description],
    };
  }
}

const numberKeys = [
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
];

/** The named keywords of a node, consumed, as a record. */
function take(node: SchemaNode, keys: readonly string[]): JsonRecord {
  const values: Record<string, unknown> = {};
  for (const key of keys) {
    const value = node.take(key);
    if (value !== undefined) values[key] = value;
  }
  return values;
}

function stringConstraints(node: SchemaNode): Inline[] {
  const phrases: Inline[] = [];
  const format = node.take("format");
  if (format !== undefined) {
    phrases.push(formatConstraint(readString(format, `${node.where}.format`)));
  }
  const length = lengthConstraint(take(node, ["minLength", "maxLength"]));
  if (length !== null) phrases.push(length);
  const pattern = node.take("pattern");
  if (pattern !== undefined) {
    phrases.push(
      patternConstraint(readString(pattern, `${node.where}.pattern`)),
    );
  }
  return phrases;
}

/** `const`, `enum`, and the generator's open enum `x-extensible-enum`. */
function literalConstraints(node: SchemaNode): Inline[] {
  const phrases: Inline[] = [];
  if (node.has("const"))
    phrases.push([text("always "), literal(node.take("const"))]);
  if (node.has("enum")) {
    phrases.push(
      oneOfLiterals(
        "one of ",
        readArray(node.take("enum"), `${node.where}.enum`),
      ),
    );
  }
  if (node.has("x-extensible-enum")) {
    const values = readArray(
      node.take("x-extensible-enum"),
      `${node.where}.x-extensible-enum`,
    );
    phrases.push([
      ...oneOfLiterals("known values ", values),
      text("; other values may appear"),
    ]);
  }
  return phrases;
}

/** The value of a literal-only schema (`{ const }`, optionally typed). */
function literalValue(schema: JsonSchema): unknown {
  if (!isRecord(schema) || !("const" in schema)) return undefined;
  const keys = Object.keys(schema)
    .filter((key) => key !== "type")
    .join();
  return keys === "const" ? schema.const : undefined;
}

function isAnySchema(value: unknown): boolean {
  return value === true || (isRecord(value) && Object.keys(value).length === 0);
}

function schemaValue(value: unknown, where: string): JsonSchema {
  if (typeof value === "boolean" || isRecord(value)) return value;
  throw new Error(`${where}: expected a schema`);
}

function recordValue(value: unknown, where: string): JsonRecord {
  if (!isRecord(value)) throw new Error(`${where}: expected an object`);
  return value;
}
