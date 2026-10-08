import { expect } from "bun:test";
import { createOrganizationGroupOperation } from "@tearleads/validators/operation";
import { requestPath } from "./dualPaneRequestSummary";
import type { ProxiedApiRequest } from "./proxiedApiResponse";

export interface ExpectedWorkflowMutation {
  readonly method: string;
  readonly path: RegExp;
  readonly count: number;
  readonly maxPreparations?: number;
}

/** Exclude only bounded, validated rollback responses from completed-work budgets. */
export function completedWorkflowRequests(
  requests: readonly ProxiedApiRequest[],
  mutations: readonly ExpectedWorkflowMutation[],
) {
  const preparations = new Set<ProxiedApiRequest>();
  for (const mutation of mutations) {
    const matches = requests.filter(
      (request) =>
        request.method === mutation.method &&
        mutation.path.test(requestPath(request.url)),
    );
    const pending = matches.filter((request) => request.status === 202);
    expect(pending.length).toBeLessThanOrEqual(mutation.maxPreparations ?? 0);
    for (const request of pending) {
      createOrganizationGroupOperation.responses[202].parse(
        JSON.parse(request.responseBody),
      );
      const committed = matches.find(
        (candidate) =>
          candidate.status === 200 &&
          candidate.url === request.url &&
          candidate.requestBody === request.requestBody,
      );
      expect(committed).toBeDefined();
      preparations.add(request);
    }
  }
  return requests.filter((request) => !preparations.has(request));
}
