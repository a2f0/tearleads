import { afterEach, expect, test } from "bun:test";
import { createDomainScope } from "@tearleads/client-sdk";
import { act, cleanup, renderHook } from "@testing-library/react";
import { createDocumentDraft } from "./documentDraft";
import { useScopedDocumentSummaries } from "./useScopedDocumentSummaries";

afterEach(cleanup);

test("identity rotation hides old rows and rejects a delayed old-scope callback", () => {
  const firstScope = createDomainScope();
  const secondScope = createDomainScope();
  let currentScope = firstScope;
  const getCurrentScope = () => currentScope;
  const view = renderHook(
    ({ scope }) => useScopedDocumentSummaries(scope, getCurrentScope),
    { initialProps: { scope: firstScope } },
  );
  const oldUpdate = view.result.current.setSummaryState;
  const oldNote = createDocumentDraft({ containerId: "old-root" });
  act(() =>
    oldUpdate({ domainScope: firstScope, summaries: [oldNote], ready: true }),
  );
  expect(view.result.current.summaries).toEqual([oldNote]);
  currentScope = secondScope;
  view.rerender({ scope: secondScope });
  expect(view.result.current.summaries).toEqual([]);
  expect(view.result.current.ready).toBe(false);
  const nextNote = createDocumentDraft({ containerId: "new-root" });
  act(() =>
    view.result.current.setSummaryState({
      domainScope: secondScope,
      summaries: [nextNote],
      ready: true,
    }),
  );
  act(() =>
    oldUpdate({ domainScope: firstScope, summaries: [oldNote], ready: true }),
  );
  expect(view.result.current.summaries).toEqual([nextNote]);
  expect(view.result.current.ready).toBe(true);
});
