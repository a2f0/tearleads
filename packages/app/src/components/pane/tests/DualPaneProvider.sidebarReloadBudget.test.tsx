import { afterEach, expect, test } from "bun:test";
import { cleanup } from "@testing-library/react";
import invariant from "invariant";
import {
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
  getExplorerSidebarItemsByName,
  getPaneRoot,
  renderSinglePane,
  waitForSinglePaneProvisioning,
} from "../../../../test/helpers/dual-pane/dualPaneCore";
import {
  openExplorer,
  refreshUntil,
} from "../../../../test/helpers/dual-pane/dualPaneExplorerKit";
import {
  resetMockServer,
  useTestApiAppHandlers,
} from "../../../../test/helpers/mswServer";
import { waitForPaneRuntimeToSettle } from "../../../../test/helpers/paneTestUtils";

// Integration regression canary for the cold-bootstrap sidebar flicker (PR #1401,
// then hardened by PR #1403's hook-level test). Each documentLinkProjectionVersion
// bump schedules a coalesced, NON-destructive sidebar reload pass (stale rows stay
// rendered and swap in place — issue #1672 fix 6 removed the preserveRows:false
// blank), and each bump is a membership-gated
// onDocumentLinksChanged(changedContainerIds) call in useExplorerViewProjectionSync.
// Pre-fix the view
// fired that on EVERY reconciled delta, so the counter climbed ~15x over bootstrap
// and the "You" contact + Trash rows re-blanked ~once per tick. Post-fix it only
// bumps on genuine container->document membership changes.
//
// This asserts the whole real stack end-to-end (view -> reconciler -> SDK ->
// sidebar), which the Tier-1 fake-view test cannot: after a full cold bootstrap
// settles, the reload-pass counter (stamped on the sidebar viewport as
// data-document-link-projection-version) must stay within a small bound.
//
// SCOPE: this bounds the fix's trigger signal (documentLinkProjectionVersion),
// which is the ONLY scheduler of a link-refresh reload pass
// (useExplorerSidebarWindows.ts). Reload passes no longer blank rows, but each
// still costs window re-queries, so an unbounded counter would still mean churn.
// It does not police hypothetical future blanking via other paths (a ready-gate
// thrash or documentQueries churn wholesale-clearing the window map); those are
// separate mechanisms. Single-pane matches the reported
// bug (cold bootstrap of one identity); the two-pane explorer re-render loop is a
// separate, documented issue.

const SIDEBAR_RELOAD_VIEWPORT_SELECTOR = ".explorer-sidebar-viewport";
const SETTLE_TIMEOUT_MS = 45_000;
const ROW_DISCOVERY_TIMEOUT_MS = 20_000;

// Upper bound on link-refresh reload passes across a single-pane cold bootstrap.
// Measured a STABLE 1 across 5 fixed-main runs locally (zero variance): the first
// membership transition as documents appear under their containers. Reverting the
// #1401 membership gate to an unconditional bump measured 9 and trips this test.
// The bound is set deliberately loose relative to the observed 1 — this suite is
// known-flaky and a false-fail would get the canary disabled, so headroom matters
// more than catching a hypothetical partial regression. The plausible legit
// worst case under CI contention is a handful of bumps (first apply on an empty
// map, then the self-contact landing, then any domain-scope/view rotation);
// bound=6 tolerates that while still failing hard on the ~9 regression. If the
// observed value climbs toward the bound on CI, INVESTIGATE a partial regression
// rather than raising the bound.
const MAX_SIDEBAR_LINK_RELOAD_PASSES = 6;

afterEach(async () => {
  cleanup();
  globalThis.localStorage.clear();
  await resetMockServer();
});

function readSidebarReloadCount(pane: HTMLElement): number {
  const viewport = pane.querySelector<HTMLElement>(
    SIDEBAR_RELOAD_VIEWPORT_SELECTOR,
  );
  invariant(viewport, "Expected the explorer sidebar viewport to be rendered.");
  // Fail loudly if the seam is missing rather than letting Number(null)=>NaN or a
  // stray value produce a confusing downstream assertion (e.g. NaN <= 6).
  const versionAttr = viewport.getAttribute(
    "data-document-link-projection-version",
  );
  invariant(
    versionAttr !== null,
    "Expected data-document-link-projection-version attribute on the viewport.",
  );
  const version = Number(versionAttr);
  invariant(
    !Number.isNaN(version),
    `Expected a numeric reload counter, got "${versionAttr}".`,
  );
  return version;
}

test(
  "cold bootstrap keeps sidebar link reload passes within budget",
  async () => {
    useTestApiAppHandlers();
    const view = renderSinglePane();
    const pane = getPaneRoot(view, "left");

    await waitForSinglePaneProvisioning(pane);
    await openExplorer(pane);

    // Pre-sample guard 1: wait until the flicker-prone system rows have actually
    // been discovered, so we never sample mid-bootstrap (before membership
    // settles) and read an artificially low count.
    await refreshUntil(
      pane,
      () => getExplorerSidebarItemsByName(pane, "Contacts").length > 0,
      "Bootstrap did not provision the Contacts system folder.",
      ROW_DISCOVERY_TIMEOUT_MS,
    );
    await refreshUntil(
      pane,
      () => getExplorerSidebarItemsByName(pane, "Trash").length > 0,
      "Bootstrap did not provision the Trash system folder.",
      ROW_DISCOVERY_TIMEOUT_MS,
    );
    // Pre-sample guard 2: the "You" self-contact DOCUMENT row — the exact row
    // that re-blanked in the reported bug — must have rendered. Its presence
    // proves the link projection applied at least once (the first apply always
    // bumps the counter), which the container rows above cannot: under suite
    // load the settle heuristic can report quiet while document discovery still
    // has a queued trigger, and sampling then reads a counter of 0. Waiting here
    // turns the old instant >0 assertion into a deterministic precondition —
    // and waiting longer can only raise the sampled count, so the budget bound
    // below stays as strict as before.
    await refreshUntil(
      pane,
      () => getExplorerSidebarItemsByName(pane, "You").length > 0,
      "Bootstrap did not surface the You self-contact row.",
      ROW_DISCOVERY_TIMEOUT_MS,
    );

    // Pre-sample guard 3: assert the runtime has quiesced. waitForPaneRuntimeToSettle
    // wraps act() + waitForAppTestRuntimeToSettle and asserts settled===true (that
    // helper RETURNS false on timeout rather than throwing), so a premature settle
    // that would under-count fails here instead of passing green. An explicit
    // timeout well under the test budget keeps slow-CI a hard fail, not a slow pass.
    await waitForPaneRuntimeToSettle(SETTLE_TIMEOUT_MS);

    // readSidebarReloadCount invariants that the seam is present and numeric, so a
    // missing/garbled attribute fails there with a clear message (not as NaN <= 6).
    const reloadPasses = readSidebarReloadCount(pane);

    // The You-row guard above proves the projection applied, so a zero here is
    // a broken seam (the attribute stopped tracking applies), not a race.
    expect(reloadPasses).toBeGreaterThan(0);

    // The clamp: content-only sync churn must NOT drive link reload passes.
    expect(reloadPasses).toBeLessThanOrEqual(MAX_SIDEBAR_LINK_RELOAD_PASSES);

    // Liveness matching the reported symptom: the "You" self-contact document row
    // — the exact row that re-blanked ~15x — is actually present after settle, so
    // the bounded count reflects a sidebar that rendered the flicker-prone rows
    // (not one that short-circuited). Contacts + Trash containers corroborate.
    expect(getExplorerSidebarItemsByName(pane, "You").length).toBeGreaterThan(
      0,
    );
    expect(
      getExplorerSidebarItemsByName(pane, "Contacts").length,
    ).toBeGreaterThan(0);
    expect(getExplorerSidebarItemsByName(pane, "Trash").length).toBeGreaterThan(
      0,
    );
  },
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
);
