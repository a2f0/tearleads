import { expect } from "bun:test";
import { requestPath } from "./dualPaneRequestSummary";
import { listProxiedApiRequests } from "./mswServer";
import { waitForPaneRuntimeToSettle } from "./paneTestUtils";
import {
  expectProxiedApiRequestBudget,
  type ProxiedApiRequestBudget,
  profileProxiedApiRequests,
} from "./proxiedApiRequestBudget";
import { waitForCondition } from "./waitForCondition";

/** Measure a settled operation, including its resulting background convergence. */
export async function measureWorkflowRequests(input: {
  label: string;
  operation: () => Promise<void>;
  budget: ProxiedApiRequestBudget;
  mutations: ReadonlyArray<{ method: string; path: RegExp; count: number }>;
}) {
  await waitForPaneRuntimeToSettle(20_000);
  const start = listProxiedApiRequests().length;
  await input.operation();
  // Some local-first actions return before their structural queue is registered
  // with the sync coordinator. Require the remote commits before testing idle.
  await waitForCondition(
    () =>
      input.mutations.every(
        (mutation) =>
          listProxiedApiRequests()
            .slice(start)
            .filter(
              (request) =>
                request.method === mutation.method &&
                mutation.path.test(requestPath(request.url)) &&
                request.status === 200,
            ).length >= mutation.count,
      ),
    `${input.label} did not commit its expected mutations`,
    20_000,
  );
  await waitForPaneRuntimeToSettle(20_000);
  const requests = listProxiedApiRequests().slice(start);
  profileProxiedApiRequests(input.label, start);
  expectProxiedApiRequestBudget(input.label, requests, input.budget);
  for (const mutation of input.mutations) {
    const matches = requests.filter(
      (request) =>
        request.method === mutation.method &&
        mutation.path.test(requestPath(request.url)),
    );
    expect(
      matches,
      `${input.label}: ${mutation.method} ${mutation.path}`,
    ).toHaveLength(mutation.count);
    expect(matches.every((request) => request.status === 200)).toBe(true);
  }
  return requests;
}
