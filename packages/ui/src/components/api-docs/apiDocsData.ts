import type { OpenAPIV3 } from 'openapi-types';

export type ApiParameter = {
  name: string;
  location: string;
  required: boolean;
  description?: string;
  schemaType?: string;
  ref?: string;
};

export type ApiRequestBody = {
  contentTypes: string[];
  description?: string;
  required?: boolean;
  ref?: string;
};

export type ApiResponse = {
  status: string;
  description?: string;
  ref?: string;
};

export type ApiHttpMethod =
  | 'get'
  | 'post'
  | 'put'
  | 'patch'
  | 'delete'
  | 'options'
  | 'head'
  | 'trace';

export type ApiOperation = {
  id: string;
  method: ApiHttpMethod;
  path: string;
  summary: string;
  description?: string;
  tags: string[];
  parameters: ApiParameter[];
  requestBody?: ApiRequestBody;
  responses: ApiResponse[];
  deprecated?: boolean;
};

export type ApiTagGroup = {
  name: string;
  description?: string;
  operations: ApiOperation[];
};

export type ApiDocsData = {
  tagGroups: ApiTagGroup[];
  totalOperations: number;
  baseUrl?: string;
};

export type ApiDocsDataOptions = {
  fallbackTag: string;
  tagOrder?: string[];
};

const HTTP_METHODS: ApiHttpMethod[] = [
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'options',
  'head',
  'trace'
];

const METHOD_FALLBACK_TITLE = 'Untitled endpoint';

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

const isReferenceObject = (
  value:
    | OpenAPIV3.ReferenceObject
    | OpenAPIV3.ParameterObject
    | OpenAPIV3.RequestBodyObject
    | OpenAPIV3.ResponseObject
    | OpenAPIV3.SchemaObject
    | undefined
): value is OpenAPIV3.ReferenceObject => {
  return isRecord(value) && typeof value['$ref'] === 'string';
};

const slugify = (value: string): string => {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
};

const getSchemaType = (
  schema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject | undefined
): string | undefined => {
  if (!schema) {
    return undefined;
  }

  if (isReferenceObject(schema)) {
    return schema.$ref;
  }

  return typeof schema.type === 'string' ? schema.type : undefined;
};

const buildParameters = (
  pathParameters:
    | Array<OpenAPIV3.ParameterObject | OpenAPIV3.ReferenceObject>
    | undefined,
  operationParameters:
    | Array<OpenAPIV3.ParameterObject | OpenAPIV3.ReferenceObject>
    | undefined
): ApiParameter[] => {
  const parameters = [
    ...(pathParameters ?? []),
    ...(operationParameters ?? [])
  ];

  return parameters.map((param) => {
    if (isReferenceObject(param)) {
      return {
        name: 'Referenced parameter',
        location: 'ref',
        required: false,
        ref: param.$ref
      };
    }

    const schemaType = getSchemaType(param.schema);

    return {
      name: param.name,
      location: param.in,
      required: Boolean(param.required),
      ...(param.description ? { description: param.description } : {}),
      ...(schemaType ? { schemaType } : {})
    };
  });
};

const buildRequestBody = (
  requestBody: OpenAPIV3.RequestBodyObject | OpenAPIV3.ReferenceObject
): ApiRequestBody => {
  if (isReferenceObject(requestBody)) {
    return {
      contentTypes: [],
      ref: requestBody.$ref
    };
  }

  const contentTypes = Object.keys(requestBody.content ?? {});

  return {
    contentTypes,
    ...(requestBody.description
      ? { description: requestBody.description }
      : {}),
    ...(requestBody.required ? { required: true } : {})
  };
};

const buildResponses = (
  responses: OpenAPIV3.ResponsesObject | undefined
): ApiResponse[] => {
  if (!responses || Object.keys(responses).length === 0) {
    return [];
  }

  return Object.entries(responses).map(([status, response]) => {
    if (isReferenceObject(response)) {
      return {
        status,
        ref: response.$ref
      };
    }

    return {
      status,
      ...(response.description ? { description: response.description } : {})
    };
  });
};

const buildSummary = (
  operation: OpenAPIV3.OperationObject,
  method: ApiHttpMethod,
  path: string
): string => {
  if (operation.summary) {
    return operation.summary;
  }

  if (operation.operationId) {
    return operation.operationId;
  }

  return `${method.toUpperCase()} ${path}` || METHOD_FALLBACK_TITLE;
};

const ensureUniqueId = (value: string, used: Set<string>): string => {
  if (!used.has(value)) {
    used.add(value);
    return value;
  }

  let suffix = 2;
  let next = `${value}-${suffix}`;

  while (used.has(next)) {
    suffix += 1;
    next = `${value}-${suffix}`;
  }

  used.add(next);
  return next;
};

export const buildApiDocsData = (
  spec: OpenAPIV3.Document,
  options: ApiDocsDataOptions
): ApiDocsData => {
  const { fallbackTag, tagOrder } = options;
  const usedIds = new Set<string>();
  const operations: ApiOperation[] = [];

  const pathEntries = Object.entries(spec.paths ?? {}).sort(([left], [right]) =>
    left.localeCompare(right)
  );

  for (const [path, pathItem] of pathEntries) {
    if (!pathItem || isReferenceObject(pathItem)) {
      continue;
    }

    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];

      if (!operation) {
        continue;
      }

      const tags =
        operation.tags && operation.tags.length > 0
          ? operation.tags
          : [fallbackTag];

      const baseId = slugify(operation.operationId ?? `${method}-${path}`);
      const id = ensureUniqueId(baseId || slugify(path), usedIds);

      operations.push({
        id,
        method,
        path,
        summary: buildSummary(operation, method, path),
        ...(operation.description
          ? { description: operation.description }
          : {}),
        tags,
        parameters: buildParameters(pathItem.parameters, operation.parameters),
        ...(operation.requestBody
          ? { requestBody: buildRequestBody(operation.requestBody) }
          : {}),
        responses: buildResponses(operation.responses),
        ...(operation.deprecated ? { deprecated: true } : {})
      });
    }
  }

  const tagDescriptions = new Map<string, string | undefined>();
  if (spec.tags) {
    for (const tag of spec.tags) {
      tagDescriptions.set(tag.name, tag.description);
    }
  }

  const tagNames = new Set<string>();
  for (const operation of operations) {
    for (const tag of operation.tags) {
      tagNames.add(tag);
    }
  }

  const orderedTags: string[] = [];
  if (tagOrder && tagOrder.length > 0) {
    for (const tag of tagOrder) {
      if (tagNames.has(tag)) {
        orderedTags.push(tag);
      }
    }
  } else if (spec.tags) {
    for (const tag of spec.tags) {
      if (tagNames.has(tag.name)) {
        orderedTags.push(tag.name);
      }
    }
  }

  for (const tag of tagNames) {
    if (!orderedTags.includes(tag)) {
      orderedTags.push(tag);
    }
  }

  const tagGroups = orderedTags.map((tag) => {
    const description = tagDescriptions.get(tag);

    return {
      name: tag,
      ...(description ? { description } : {}),
      operations: operations.filter((operation) => operation.tags.includes(tag))
    };
  });

  const baseUrl = spec.servers?.[0]?.url;

  return {
    tagGroups,
    totalOperations: operations.length,
    ...(baseUrl ? { baseUrl } : {})
  };
};
