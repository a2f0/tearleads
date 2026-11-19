import { afterEach, expect, test } from "bun:test";
import { cleanup, within } from "@testing-library/react";
import invariant from "invariant";
import {
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
  getExplorerSidebarItemsByName,
  getPaneRoot,
  renderSinglePane,
  selectContainerAndWaitForItemTable,
  waitForSinglePaneProvisioning,
} from "../../../../test/helpers/dual-pane/dualPaneCore";
import {
  openExplorer,
  refreshUntil,
} from "../../../../test/helpers/dual-pane/dualPaneExplorerKit";
import {
  MOCK_SERVER_RESET_TIMEOUT_MS,
  resetMockServer,
  useTestApiAppHandlers,
} from "../../../../test/helpers/msw/server";
import { waitForPaneRuntimeToSettle } from "../../../../test/helpers/paneTestUtils";

// Count membership changes through the full cold-bootstrap stack. Content-only
// sync deltas must not invalidate document projections.
const EXPLORER_SELECTOR = ".explorer";
const SETTLE_TIMEOUT_MS = 45_000;
const ROW_DISCOVERY_TIMEOUT_MS = 20_000;

// Upper bound on document link projection changes across a single-pane cold bootstrap.
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
const MAX_LINK_PROJECTION_CHANGES = 6;

afterEach(async () => {
  cleanup();
  globalThis.localStorage.clear();
  await resetMockServer();
}, MOCK_SERVER_RESET_TIMEOUT_MS);

function readProjectionVersion(pane: HTMLElement): number {
  const explorer = pane.querySelector<HTMLElement>(EXPLORER_SELECTOR);
  invariant(explorer, "Expected Explorer to be rendered.");
  // Fail loudly if the seam is missing rather than letting Number(null)=>NaN or a
  // stray value produce a confusing downstream assertion (e.g. NaN <= 6).
  const versionAttr = explorer.getAttribute(
    "data-document-link-projection-version",
  );
  invariant(
    versionAttr !== null,
    "Expected data-document-link-projection-version attribute on the explorer.",
  );
  const version = Number(versionAttr);
  invariant(
    !Number.isNaN(version),
    `Expected a numeric projection version, got "${versionAttr}".`,
  );
  return version;
}

test(
  "cold bootstrap keeps link projection changes within budget",
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
    await selectContainerAndWaitForItemTable(pane, "Contacts");
    await within(pane).findByRole(
      "button",
      { name: "You" },
      { timeout: ROW_DISCOVERY_TIMEOUT_MS },
    );

    // Pre-sample guard 3: assert the runtime has quiesced. waitForPaneRuntimeToSettle
    // wraps act() + waitForAppTestRuntimeToSettle and asserts settled===true (that
    // helper RETURNS false on timeout rather than throwing), so a premature settle
    // that would under-count fails here instead of passing green. An explicit
    // timeout well under the test budget keeps slow-CI a hard fail, not a slow pass.
    await waitForPaneRuntimeToSettle(SETTLE_TIMEOUT_MS);

    // readProjectionVersion invariants that the seam is present and numeric, so a
    // missing/garbled attribute fails there with a clear message (not as NaN <= 6).
    const projectionVersion = readProjectionVersion(pane);

    // The You-row guard above proves the projection applied, so a zero here is
    // a broken seam (the attribute stopped tracking applies), not a race.
    expect(projectionVersion).toBeGreaterThan(0);

    // The clamp: content-only sync churn must NOT drive link projection changes.
    expect(projectionVersion).toBeLessThanOrEqual(MAX_LINK_PROJECTION_CHANGES);

    expect(within(pane).getByRole("button", { name: "You" })).toBeTruthy();
    expect(getExplorerSidebarItemsByName(pane, "You")).toHaveLength(0);
    expect(
      getExplorerSidebarItemsByName(pane, "Contacts").length,
    ).toBeGreaterThan(0);
    expect(getExplorerSidebarItemsByName(pane, "Trash").length).toBeGreaterThan(
      0,
    );
  },
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
);
