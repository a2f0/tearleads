import {
  type ApiBody,
  type ApiDocument,
  type ApiOperation,
  type JsonSchema,
  parseApiDocument,
} from "./openApiDocument";
import {
  type Neighbours,
  neighbours,
  operationSlugs,
  type SchemaUsage,
  schemaUsage,
  type TagGroup,
  tagGroups,
} from "./referenceIndex";
import {
  createTextRenderer,
  type GlossaryTerm,
  glossaryTerms,
  type RichText,
  type TextRenderer,
} from "./richText";
import { refName, SchemaDescriber, type Shape } from "./schemaShape";

/**
 * View models for the API reference pages. Each page gets its own text
 * renderer, and text is rendered in the order the page shows it, so the
 * first mention of a glossary term on screen is the one that links.
 */

export interface NamedShape {
  readonly name: string;
  readonly location?: string;
  readonly required: boolean;
  readonly shape: Shape;
}

export interface BodyView {
  readonly mediaType: string;
  /** The named schema the body is, when it is one. */
  readonly schemaName: string | undefined;
  readonly shape: Shape;
}

export interface ResponseView {
  readonly status: string;
  readonly reason: string;
  /** Success bodies show the fields; other bodies show only the type. */
  readonly expanded: boolean;
  readonly body: BodyView | undefined;
  readonly headers: readonly NamedShape[];
}

export interface OperationPage {
  readonly operation: ApiOperation;
  readonly lead: RichText;
  readonly description: RichText;
  readonly parameters: readonly NamedShape[];
  readonly requestBody: BodyView | undefined;
  readonly responses: readonly ResponseView[];
  readonly refinements: readonly RichText[];
  readonly neighbours: Neighbours;
}

export interface SchemaPage {
  readonly name: string;
  readonly shape: Shape;
  readonly usage: SchemaUsage;
}

export interface IndexPage {
  readonly intro: RichText;
  readonly groups: readonly (TagGroup & { readonly description: RichText })[];
  readonly schemaNames: readonly string[];
}

export interface ApiReference {
  readonly document: ApiDocument;
  readonly slugs: ReadonlyMap<string, string>;
  /** Each tag's heading anchor on the index page. */
  readonly tagAnchors: ReadonlyMap<string, string>;
  index(): IndexPage;
  operationPage(operation: ApiOperation): OperationPage;
  schemaPage(name: string): SchemaPage;
}

/**
 * Refinement ids name the rule; the description is a lower-case clause.
 * Make it a sentence, and show the field names it mentions as code.
 */
export function refinementSentence(description: string): string {
  const coded = description
    .split(/(`[^`]*`)/)
    .map((part, index) =>
      index % 2 === 1
        ? part
        : part.replace(/\b[a-z]+(?:[A-Z][a-z0-9]*)+\b/g, "`$&`"),
    )
    .join("");
  const capitalized = /^[a-z]+\b/.test(coded)
    ? `${coded.charAt(0).toUpperCase()}${coded.slice(1)}`
    : coded;
  return /[.!?]$/.test(capitalized) ? capitalized : `${capitalized}.`;
}

function describeBody(
  body: ApiBody,
  describer: SchemaDescriber,
  schemas: ReadonlyMap<string, JsonSchema>,
  expand: boolean,
  where: string,
): BodyView {
  const schemaName = refName(body.schema);
  const target = schemaName === undefined ? undefined : schemas.get(schemaName);
  if (schemaName !== undefined && target === undefined) {
    throw new Error(`${where}: unknown schema ${schemaName}`);
  }
  const shape =
    expand && target !== undefined
      ? describer.describe(target, schemaName ?? where)
      : describer.describe(body.schema, where);
  return { mediaType: body.mediaType, schemaName, shape };
}

function buildOperationPage(
  document: ApiDocument,
  operation: ApiOperation,
  render: TextRenderer,
): OperationPage {
  const describer = new SchemaDescriber(render);
  const where = operation.operationId;
  const lead = render(operation.summary);
  const description = render(operation.description);
  const parameters = operation.parameters.map((parameter) => ({
    name: parameter.name,
    location: parameter.location,
    required: parameter.required,
    shape: withDescription(
      render(parameter.description),
      describer.describe(parameter.schema, `${where}.${parameter.name}`),
    ),
  }));
  const requestBody =
    operation.requestBody === undefined
      ? undefined
      : describeBody(
          operation.requestBody,
          describer,
          document.schemas,
          true,
          `${where}.body`,
        );
  const responses = operation.responses.map((response) => {
    const at = `${where}.${response.status}`;
    const expanded = response.status.startsWith("2");
    return {
      status: response.status,
      reason: response.reason,
      expanded,
      body:
        response.body === undefined
          ? undefined
          : describeBody(
              response.body,
              describer,
              document.schemas,
              expanded,
              at,
            ),
      headers: response.headers.map((header) => ({
        name: header.name,
        required: header.required,
        shape: withDescription(
          render(header.description),
          describer.describe(header.schema, `${at}.${header.name}`),
        ),
      })),
    };
  });
  const refinements = operation.refinements.map((refinement) =>
    render(refinementSentence(refinement.description)),
  );
  return {
    operation,
    lead,
    description,
    parameters,
    requestBody,
    responses,
    refinements,
    neighbours: neighbours(document, operation),
  };
}

function withDescription(description: RichText, shape: Shape): Shape {
  return { ...shape, description: [...description, ...shape.description] };
}

export function createApiReference(
  openApiText: string,
  glossaryMarkdown: string,
): ApiReference {
  const document = parseApiDocument(openApiText);
  const terms: readonly GlossaryTerm[] = glossaryTerms(glossaryMarkdown);
  const slugs = operationSlugs(document.operations);
  const usage = schemaUsage(document);
  const groups = tagGroups(document);
  return {
    document,
    slugs,
    tagAnchors: new Map(groups.map((group) => [group.tag.name, group.anchor])),
    index() {
      const render = createTextRenderer(terms);
      return {
        intro: render(document.description),
        groups: groups.map((group) => ({
          ...group,
          description: render(group.tag.description),
        })),
        schemaNames: [...document.schemas.keys()],
      };
    },
    operationPage(operation) {
      return buildOperationPage(document, operation, createTextRenderer(terms));
    },
    schemaPage(name) {
      const schema = document.schemas.get(name);
      const used = usage.get(name);
      if (schema === undefined || used === undefined) {
        throw new Error(`No schema ${name}`);
      }
      const describer = new SchemaDescriber(createTextRenderer(terms));
      return { name, shape: describer.describe(schema, name), usage: used };
    },
  };
}
