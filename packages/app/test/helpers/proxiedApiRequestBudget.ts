import { expect } from "bun:test";
import {
  type ProxiedApiRequest,
  requestPath,
  requestPathAndQuery,
} from "./dualPaneRequestSummary";
import { listProxiedApiRequests } from "./mswServer";

export interface ProxiedApiRequestBudget {
  byRequest?: Readonly<Record<string, number>>;
  total: number;
}

const requestProfileEnv = process.env as {
  DUAL_PANE_REQUEST_PROFILE?: string;
  DUAL_PANE_REQUEST_PROFILE_DETAIL?: string;
};

function normalizeRequestPath(path: string): string {
  return (
    path
      .replace(/^\/auth\/user-identity\/[^/]+$/u, "/auth/user-identity/:userId")
      .replace(
        /^\/organizations\/[^/]+\/groups$/u,
        "/organizations/:organizationId/groups",
      )
      .replace(
        /^\/organizations\/[^/]+\/read-model$/u,
        "/organizations/:organizationId/read-model",
      )
      // Group-subresource reads issued by the org-manager refresh fan-out. Anchored
      // after the bare `/groups$` rule so the group id collapses too.
      .replace(
        /^\/organizations\/[^/]+\/groups\/[^/]+\/containers$/u,
        "/organizations/:organizationId/groups/:groupId/containers",
      )
      .replace(
        /^\/organizations\/[^/]+\/groups\/[^/]+\/members$/u,
        "/organizations/:organizationId/groups/:groupId/members",
      )
      .replace(
        /^\/organizations\/[^/]+\/groups\/[^/]+\/policy-commit$/u,
        "/organizations/:organizationId/groups/:groupId/policy-commit",
      )
      .replace(
        /^\/organizations\/[^/]+\/billing$/u,
        "/organizations/:organizationId/billing",
      )
      // Org-scoped reads the org-manager directory/group refreshers re-issue after a
      // roster mutation; normalized so request-volume budgets can pin them.
      .replace(
        /^\/organizations\/[^/]+\/directory$/u,
        "/organizations/:organizationId/directory",
      )
      .replace(
        /^\/organizations\/[^/]+\/data-usage$/u,
        "/organizations/:organizationId/data-usage",
      )
      .replace(
        /^\/organizations\/[^/]+\/grants$/u,
        "/organizations/:organizationId/grants",
      )
      .replace(
        /^\/principals\/group\/[^/]+\/policy$/u,
        "/principals/group/:groupId/policy",
      )
      .replace(
        /^\/principals\/organization\/[^/]+\/policy$/u,
        "/principals/organization/:organizationId/policy",
      )
      .replace(
        /^\/containers\/[^/]+\/documents$/u,
        "/containers/:containerId/documents",
      )
      .replace(
        /^\/containers\/[^/]+\/writer-projection$/u,
        "/containers/:containerId/writer-projection",
      )
      .replace(
        /^\/containers\/[^/]+\/share$/u,
        "/containers/:containerId/share",
      )
      .replace(/^\/containers\/[^/]+\/move$/u, "/containers/:containerId/move")
      .replace(
        /^\/documents\/[^/]+\/writer-projection$/u,
        "/documents/:documentId/writer-projection",
      )
      .replace(/^\/documents\/[^/]+\/sync$/u, "/documents/:documentId/sync")
      .replace(
        /^\/documents\/[^/]+\/attachments$/u,
        "/documents/:documentId/attachments",
      )
      .replace(
        /^\/blobs\/[^/]+\/attachment-bindings$/u,
        "/blobs/:blobId/attachment-bindings",
      )
      .replace(
        /^\/blobs\/stages\/multipart\/[^/]+\/parts\/[^/]+\/bytes$/u,
        "/blobs/stages/multipart/:stageId/parts/:partNumber/bytes",
      )
      .replace(
        /^\/blobs\/stages\/multipart\/[^/]+\/complete$/u,
        "/blobs/stages/multipart/:stageId/complete",
      )
      .replace(
        /^\/blobs\/stages\/multipart\/[^/]+$/u,
        "/blobs/stages/multipart/:stageId",
      )
      .replace(/^\/blobs\/[^/]+\/bytes$/u, "/blobs/:blobId/bytes")
  );
}

function shortRequestPathIds(path: string): string {
  const queryStartIndex = path.indexOf("?");
  const pathname =
    queryStartIndex === -1 ? path : path.slice(0, queryStartIndex);
  const query = queryStartIndex === -1 ? "" : path.slice(queryStartIndex);

  return `${pathname
    .split("/")
    .map((segment) =>
      segment.length >= 16 && /^[0-9a-f-]+$/iu.test(segment)
        ? segment.slice(0, 8)
        : segment,
    )
    .join("/")}${query}`;
}

function proxiedApiRequestVolumeKey(request: ProxiedApiRequest): string {
  return `${request.method} ${normalizeRequestPath(requestPath(request.url))}`;
}

function countProxiedApiRequestVolume(
  requests: readonly ProxiedApiRequest[],
): Map<string, { count: number; statuses: Map<number, number> }> {
  const countsByRequest = new Map<
    string,
    { count: number; statuses: Map<number, number> }
  >();

  for (const request of requests) {
    const key = proxiedApiRequestVolumeKey(request);
    const entry = countsByRequest.get(key) ?? { count: 0, statuses: new Map() };
    entry.count += 1;
    entry.statuses.set(
      request.status,
      (entry.statuses.get(request.status) ?? 0) + 1,
    );
    countsByRequest.set(key, entry);
  }

  return countsByRequest;
}

export function summarizeProxiedApiRequestVolume(
  requests: readonly ProxiedApiRequest[],
): string {
  return [...countProxiedApiRequestVolume(requests).entries()]
    .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
    .map(([key, entry]) => {
      const statuses = [...entry.statuses.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([status, count]) => `${status}:${count}`)
        .join(",");
      return `${entry.count.toString().padStart(3, " ")} ${key} statuses=${statuses}`;
    })
    .join("\n");
}

function summarizeRepeatedProxiedApiRequestPaths(
  requests: readonly ProxiedApiRequest[],
): string {
  const countsByPath = new Map<string, number>();
  for (const request of requests) {
    const key = `${request.method} ${shortRequestPathIds(requestPathAndQuery(request.url))}`;
    countsByPath.set(key, (countsByPath.get(key) ?? 0) + 1);
  }

  const repeatedPaths = [...countsByPath.entries()]
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  if (repeatedPaths.length === 0) {
    return "(no repeated exact paths)";
  }

  return repeatedPaths
    .map(([key, count]) => `${count.toString().padStart(3, " ")} ${key}`)
    .join("\n");
}

export function profileProxiedApiRequests(
  label: string,
  requestStartIndex: number,
  requestEndIndex = listProxiedApiRequests().length,
) {
  if (requestProfileEnv.DUAL_PANE_REQUEST_PROFILE !== "1") {
    return;
  }

  const requests = listProxiedApiRequests().slice(
    requestStartIndex,
    requestEndIndex,
  );
  console.info(
    `[dual-pane-request-profile] ${label} total=${requests.length}\n${summarizeProxiedApiRequestVolume(requests)}`,
  );
  if (requestProfileEnv.DUAL_PANE_REQUEST_PROFILE_DETAIL === "1") {
    console.info(
      `[dual-pane-request-profile-detail] ${label} repeated-paths\n${summarizeRepeatedProxiedApiRequestPaths(requests)}`,
    );
  }
}

export function expectProxiedApiRequestBudget(
  label: string,
  requests: readonly ProxiedApiRequest[],
  budget: ProxiedApiRequestBudget,
) {
  const requestVolumeSummary = summarizeProxiedApiRequestVolume(requests);
  const repeatedPathSummary = summarizeRepeatedProxiedApiRequestPaths(requests);
  const failureSummary = `request volume=\n${requestVolumeSummary}\nrepeated paths=\n${repeatedPathSummary}`;

  expect(
    requests.length,
    `${label} exceeded proxied API request budget ${budget.total}.\n${failureSummary}`,
  ).toBeLessThanOrEqual(budget.total);

  const countsByRequest = countProxiedApiRequestVolume(requests);
  for (const [requestKey, requestBudget] of Object.entries(
    budget.byRequest ?? {},
  )) {
    const actualCount = countsByRequest.get(requestKey)?.count ?? 0;
    expect(
      actualCount,
      `${label} exceeded proxied API request budget for ${requestKey}: ${actualCount} > ${requestBudget}.\n${failureSummary}`,
    ).toBeLessThanOrEqual(requestBudget);
  }
}
