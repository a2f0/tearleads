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
        const known = options.knownCurrentState;
        const query = new URLSearchParams({
          grant: source.grant,
          afterVersion: String(afterVersion),
          ...(known ? { knownStateHash: known.stateHash } : {}),
        });
        const response = await projectionRouteRequest(
          `/principals/history?${query}`,
          token,
        );
        if (!response.ok)
          throw new Error(
            `Projection history failed: ${response.status}: ${await response.text()}`,
          );
        const page = PrincipalPolicySnapshotPageResponseSchema.parse(
          await response.json(),
        );
        const currentState = known ?? page.currentState;
        if (!currentState || (known && page.currentState !== null))
          throw new Error("Projection history answered the wrong head form");
        const data = { ...page, currentState };
        yield { ok: true as const, data };
        if (data.historyPage.nextAfterVersion === null) return;
        afterVersion = data.historyPage.nextAfterVersion;
      } while (afterVersion < source.head.version);
    },
  };
}
