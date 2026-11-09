import { expect, test } from "bun:test";
import {
  initialReconciliationPass,
  type ReconciliationPassState,
  transitionReconciliationPass as transition,
} from "./organizationReadModelPassMachine";
import type { OrganizationReadModelScope } from "./organizationReadModelScope";

const scopeA: OrganizationReadModelScope = {
  domainScope: {} as OrganizationReadModelScope["domainScope"],
  organizationId: "org-a",
  userId: "user-a",
};
const scopeB: OrganizationReadModelScope = { ...scopeA, userId: "user-b" };

const queued = initialReconciliationPass({
  demanded: false,
  requiresSdkBarrier: true,
  scope: scopeA,
});

test("requests merge flags and only a queued pass adopts a new scope", () => {
  expect(
    transition(queued, {
      type: "requested",
      demanded: true,
      requiresSdkBarrier: false,
      scope: scopeB,
    }),
  ).toEqual({
    status: "queued",
    demanded: true,
    requiresSdkBarrier: true,
    scope: scopeB,
  });
  const checking = transition(queued, {
    type: "iterationStarted",
    scope: scopeA,
  });
  expect(
    transition(checking, {
      type: "requested",
      demanded: true,
      requiresSdkBarrier: false,
      scope: scopeB,
    }),
  ).toMatchObject({ status: "checking", demanded: true, scope: scopeA });
});

test("an iteration consumes the demand bit and a read consumes the barrier", () => {
  const demanded = transition(queued, {
    type: "requested",
    demanded: true,
    requiresSdkBarrier: false,
    scope: scopeA,
  });
  const checking = transition(demanded, {
    type: "iterationStarted",
    scope: scopeA,
  });
  expect(checking).toEqual({
    status: "checking",
    demanded: false,
    iteration: 1,
    owesRead: true,
    requiresSdkBarrier: true,
    scope: scopeA,
  });
  const reading = transition(checking, { type: "readStarted", iteration: 1 });
  expect(reading).toEqual({
    status: "reading",
    demanded: false,
    iteration: 1,
    requiresSdkBarrier: false,
    scope: scopeA,
    useSdkBarrier: true,
  });
  expect(
    transition(reading, { type: "iterationStarted", scope: scopeA }),
  ).toMatchObject({ status: "checking", iteration: 2, owesRead: false });
});

test("stale or inapplicable completions are ignored", () => {
  const checking = transition(queued, {
    type: "iterationStarted",
    scope: scopeA,
  });
  const next = transition(checking, {
    type: "iterationStarted",
    scope: scopeA,
  });
  const ignored: ReconciliationPassState[] = [
    transition(queued, { type: "readStarted", iteration: 1 }),
    transition(next, { type: "readStarted", iteration: 1 }),
    transition(queued, {
      type: "scopeOvertaken",
      currentScopeExists: true,
      iteration: 1,
    }),
    transition(next, {
      type: "scopeOvertaken",
      currentScopeExists: true,
      iteration: 1,
    }),
  ];
  expect(ignored).toEqual([queued, next, queued, next]);
  const reading = transition(next, { type: "readStarted", iteration: 2 });
  expect(transition(reading, { type: "readStarted", iteration: 2 })).toBe(
    reading,
  );
});

test("an overtaken scope owes a follow-up only while a scope is demanded", () => {
  const checking = transition(queued, {
    type: "iterationStarted",
    scope: scopeA,
  });
  expect(
    transition(checking, {
      type: "scopeOvertaken",
      currentScopeExists: false,
      iteration: 1,
    }),
  ).toMatchObject({ demanded: false });
  expect(
    transition(checking, {
      type: "scopeOvertaken",
      currentScopeExists: true,
      iteration: 1,
    }),
  ).toMatchObject({ demanded: true });
});
