import type { ApiClient } from "@tearleads/api-client";
import { getProjectionPolicyHistoryOperation } from "@tearleads/validators/operation";
import { PrincipalPolicySnapshotPageResponseSchema } from "@tearleads/validators/response";
import { routeApp } from "../../src/routeApp";

export async function projectionRouteRequest(
  path: string,
  token: string,
): Promise<Response> {
  const progress = new Set<string>();
  for (let attempt = 0; attempt < 2048; attempt++) {
    const response = await routeApp.request(path, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.status !== 202) return response;
    const pending = getProjectionPolicyHistoryOperation.responses[202].parse(
      await response.json(),
    );
    if (progress.has(pending.progressToken))
      throw new Error("Projection preparation stalled");
    progress.add(pending.progressToken);
  }
  throw new Error("Projection preparation exceeded the fixture budget");
}

export function projectionRouteHistory(
  token: string,
): Pick<ApiClient, "getProjectionPolicyHistoryPages"> {
  return {
    async *getProjectionPolicyHistoryPages(source, options = {}) {
      let afterVersion = options.afterVersion ?? 0;
      do {
        const query = new URLSearchParams({
          grant: source.grant,
          afterVersion: String(afterVersion),
        });
        const response = await projectionRouteRequest(
          `/principals/history?${query}`,
          token,
        );
        if (!response.ok)
          throw new Error(
            `Projection history failed: ${response.status}: ${await response.text()}`,
          );
        const data = PrincipalPolicySnapshotPageResponseSchema.parse(
          await response.json(),
        );
        yield { ok: true as const, data };
        if (data.historyPage.nextAfterVersion === null) return;
        afterVersion = data.historyPage.nextAfterVersion;
      } while (afterVersion < source.head.version);
    },
  };
}
