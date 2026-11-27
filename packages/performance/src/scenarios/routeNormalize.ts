/**
 * Normalizes API URL paths into stable route templates for multi-party
 * scenario profiling, covering keying, revocation, baseline staging,
 * principal history, container, document, organization, and blob routes.
 */

const routeRules: readonly [RegExp, string][] = [
  [/^\/auth\/user-identity\/[^/]+$/u, "/auth/user-identity/:userId"],
  [
    /^\/organizations\/[^/]+\/groups\/[^/]+\/policy-commit$/u,
    "/organizations/:organizationId/groups/:groupId/policy-commit",
  ],
  [
    /^\/organizations\/[^/]+\/groups\/[^/]+\/containers$/u,
    "/organizations/:organizationId/groups/:groupId/containers",
  ],
  [
    /^\/organizations\/[^/]+\/groups\/[^/]+\/members$/u,
    "/organizations/:organizationId/groups/:groupId/members",
  ],
  [
    /^\/organizations\/[^/]+\/groups$/u,
    "/organizations/:organizationId/groups",
  ],
  [
    /^\/organizations\/[^/]+\/read-model$/u,
    "/organizations/:organizationId/read-model",
  ],
  [
    /^\/organizations\/[^/]+\/directory$/u,
    "/organizations/:organizationId/directory",
  ],
  [
    /^\/organizations\/[^/]+\/data-usage$/u,
    "/organizations/:organizationId/data-usage",
  ],
  [
    /^\/organizations\/[^/]+\/grants$/u,
    "/organizations/:organizationId/grants",
  ],
  [
    /^\/organizations\/[^/]+\/billing$/u,
    "/organizations/:organizationId/billing",
  ],
  [
    /^\/organizations\/[^/]+\/leave-request$/u,
    "/organizations/:organizationId/leave-request",
  ],
  [
    /^\/organization-memberships\/[^/]+\/leave-request$/u,
    "/organization-memberships/:organizationId/leave-request",
  ],
  [
    /^\/principals\/(group|organization|user)\/[^/]+\/policy$/u,
    "/principals/$1/:principalId/policy",
  ],
  [
    /^\/principals\/(group|organization|user)\/[^/]+\/history$/u,
    "/principals/$1/:principalId/history",
  ],
  [
    /^\/containers\/[^/]+\/writer-projection$/u,
    "/containers/:containerId/writer-projection",
  ],
  [/^\/containers\/[^/]+\/share$/u, "/containers/:containerId/share"],
  [/^\/containers\/[^/]+\/revoke$/u, "/containers/:containerId/revoke"],
  [/^\/containers\/[^/]+\/move$/u, "/containers/:containerId/move"],
  [/^\/containers\/[^/]+\/recite$/u, "/containers/:containerId/recite"],
  [
    /^\/documents\/[^/]+\/baseline-stages\/[^/]+\/segments\/\d+$/u,
    "/documents/:documentId/baseline-stages/:stageId/segments/:index",
  ],
  [
    /^\/documents\/[^/]+\/baseline-stages\/[^/]+$/u,
    "/documents/:documentId/baseline-stages/:stageId",
  ],
  [
    /^\/documents\/[^/]+\/baseline-stages$/u,
    "/documents/:documentId/baseline-stages",
  ],
  [
    /^\/documents\/[^/]+\/writer-projection$/u,
    "/documents/:documentId/writer-projection",
  ],
  [/^\/documents\/[^/]+\/sync$/u, "/documents/:documentId/sync"],
  [/^\/documents\/[^/]+\/link$/u, "/documents/:documentId/link"],
  [/^\/documents\/[^/]+\/unlink$/u, "/documents/:documentId/unlink"],
  [
    /^\/documents\/[^/]+\/attachments\/[^/]+$/u,
    "/documents/:documentId/attachments/:attachmentId",
  ],
  [/^\/documents\/[^/]+\/attachments$/u, "/documents/:documentId/attachments"],
  [
    /^\/blobs\/[^/]+\/attachment-bindings$/u,
    "/blobs/:blobId/attachment-bindings",
  ],
  [
    /^\/blobs\/stages\/multipart\/[^/]+\/parts\/[^/]+\/upload$/u,
    "/blobs/stages/multipart/:stageId/parts/:partNumber/upload",
  ],
  [
    /^\/blobs\/stages\/multipart\/[^/]+\/parts\/[^/]+\/bytes$/u,
    "/blobs/stages/multipart/:stageId/parts/:partNumber/bytes",
  ],
  [/^\/blobs\/stages\/multipart\/[^/]+$/u, "/blobs/stages/multipart/:stageId"],
  [/^\/blobs\/[^/]+\/bytes$/u, "/blobs/:blobId/bytes"],
];

const opaqueIdSegment =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{24,})$/iu;

function collapseOpaqueSegments(pathname: string): string {
  return pathname
    .split("/")
    .map((segment) => (opaqueIdSegment.test(segment) ? ":id" : segment))
    .join("/");
}

/** Normalizes an API request URL or pathname into `METHOD /normalized/path`. */
export function normalizeScenarioRoute(
  method: string,
  urlOrPath: string,
): string {
  let pathname = urlOrPath;
  if (urlOrPath.includes("://")) {
    try {
      pathname = new URL(urlOrPath).pathname;
    } catch {
      pathname = urlOrPath;
    }
  } else {
    const queryIndex = urlOrPath.indexOf("?");
    if (queryIndex !== -1) pathname = urlOrPath.slice(0, queryIndex);
  }
  const trimmed = pathname.replace(/^\/api(?=\/)/u, "");
  for (const [pattern, replacement] of routeRules) {
    if (pattern.test(trimmed)) {
      return `${method.toUpperCase()} ${trimmed.replace(pattern, replacement)}`;
    }
  }
  return `${method.toUpperCase()} ${collapseOpaqueSegments(trimmed)}`;
}
