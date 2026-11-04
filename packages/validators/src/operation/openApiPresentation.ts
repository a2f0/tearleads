import type { HttpOperation } from "./definition";

export const OPEN_API_DESCRIPTION = [
  "The HTTP API behind Tearleads clients. Document and key material is",
  "end-to-end encrypted, so request bodies carry ciphertext, signed manifests,",
  "and key envelopes that only the client SDK can produce or open.",
  "",
  "This document is generated from the Zod operation registry in",
  "`@tearleads/validators`, which remains the runtime authority. Rules that",
  "JSON Schema cannot express are listed per operation under",
  "`x-tearleads-runtime-refinements`. See the protocol specification for",
  "message semantics, proofs, and failure handling.",
].join("\n");

const HTTP_STATUS_DESCRIPTIONS: Readonly<Record<number, string>> = {
  200: "OK",
  201: "Created",
  202: "Accepted",
  204: "No Content",
  304: "Not Modified",
  400: "Bad Request",
  401: "Unauthorized",
  402: "Payment Required",
  403: "Forbidden",
  404: "Not Found",
  409: "Conflict",
  413: "Content Too Large",
  429: "Too Many Requests",
  500: "Internal Server Error",
  502: "Bad Gateway",
  503: "Service Unavailable",
};

export function httpStatusDescription(status: number): string {
  const description = HTTP_STATUS_DESCRIPTIONS[status];
  if (description === undefined) {
    throw new Error(`HTTP status ${status} has no OpenAPI description`);
  }
  return description;
}

// Longest operation-id prefix wins, so billing operations under
// `organizations.billing` get their own group.
const OPERATION_TAGS: readonly (readonly [prefix: string, tag: string])[] = [
  ["auth.", "Auth"],
  ["billing.", "Billing webhooks"],
  ["blobs.", "Blobs"],
  ["containers.", "Containers"],
  ["documents.", "Documents"],
  ["health.", "Health"],
  ["organizationMemberships.", "Organization memberships"],
  ["organizations.billing.", "Organization billing"],
  ["organizations.", "Organizations"],
  ["principals.", "Principals"],
  ["root.", "Root operator"],
];

export function openApiOperationTag(operation: Pick<HttpOperation, "id">) {
  let match: readonly [string, string] | undefined;
  for (const entry of OPERATION_TAGS) {
    if (
      operation.id.startsWith(entry[0]) &&
      (match === undefined || entry[0].length > match[0].length)
    ) {
      match = entry;
    }
  }
  if (match === undefined) {
    throw new Error(`${operation.id} has no OpenAPI tag`);
  }
  return match[1];
}
