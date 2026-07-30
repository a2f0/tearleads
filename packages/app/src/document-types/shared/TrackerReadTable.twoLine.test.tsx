import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { ROUTED_TABLET_QUERY } from "../../navigation/breakpoints";
import { WeightReadTable } from "../weight/WeightReadTable";
import type { WeightEntryRow } from "../weight/weightEntries";

/**
 * A tracker's index table folds onto two lines on the phone tier, exactly as the
 * shared list tables do: every visible column collapses into one summary cell —
 * primary line over muted secondary line — with the kebab beside it, and the
 * per-column sort buttons collapse into a single select menu in the header.
 *
 * Weight stands in for all three trackers here: the fold is the shared table's
 * behaviour, and this is the type whose columns exercise every fold placement
 * (primary, secondary, and the dropped ordinal).
 */

const originalMatchMediaDescriptor = Object.getOwnPropertyDescriptor(
  globalThis.window ?? {},
  "matchMedia",
);

afterEach(() => {
  cleanup();
  if (typeof window === "undefined") {
    return;
  }

  document.documentElement.removeAttribute("data-navigation-mode");
  if (originalMatchMediaDescriptor) {
    Object.defineProperty(window, "matchMedia", originalMatchMediaDescriptor);
    return;
  }

  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: undefined,
  });
});

function mockPhoneLayout() {
  document.documentElement.setAttribute("data-navigation-mode", "routed");
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      addEventListener: () => undefined,
      addListener: () => undefined,
      dispatchEvent: () => false,
      // The tablet query missing is what makes this the phone tier.
      matches: query !== ROUTED_TABLET_QUERY,
      media: query,
      onchange: null,
      removeEventListener: () => undefined,
      removeListener: () => undefined,
    }),
  });
}

const entries: WeightEntryRow[] = [
  {
    createdAt: "",
    createdBy: "",
    createdByPeer: null,
    fieldEditors: {},
    id: "e1",
    measuredAt: "2026-07-16T08:30",
    notes: "Before breakfast",
    unit: "lb",
    updatedAt: "2026-07-16T08:30:00.000Z",
    updatedBy: "user-alice",
    updatedByPeer: null,
    weight: "180.5",
  },
  {
    createdAt: "",
    createdBy: "",
    createdByPeer: null,
    fieldEditors: {},
    id: "e2",
    measuredAt: "2026-07-17T08:15",
    notes: "",
    unit: "lb",
    updatedAt: "",
    updatedBy: "",
    updatedByPeer: null,
    weight: "179",
  },
];

function renderFoldedWeightTable() {
  mockPhoneLayout();
  return render(
    <WeightReadTable
      currentAuthorId="user-alice"
      entries={entries}
      onEnterEdit={() => undefined}
    />,
  );
}

test("phone tracker table folds every column into a summary and a kebab", () => {
  const view = renderFoldedWeightTable();

  expect(view.container.querySelectorAll("thead th")).toHaveLength(2);
  expect(
    view.container.querySelectorAll(".tracker-read-table-row")[0]
      ?.childElementCount,
  ).toBe(2);
  // The ordinal is dropped from the fold, so the phone row carries no "#" — but
  // the kebab it names is still there, and still numbered.
  expect(view.queryByRole("columnheader", { name: "#" })).toBeNull();
  expect(view.getByRole("button", { name: "Entry 2 actions" })).toBeTruthy();
});

test("phone tracker table stacks the measured values over the muted rest", () => {
  const view = renderFoldedWeightTable();
  const lines = view.container
    .querySelectorAll(".tracker-read-table-row")[0]
    ?.querySelectorAll(".mini-app-compact-table-line");

  expect(lines?.[0]?.textContent).toBe(
    "Weight: 180.5 lbMeasured: 2026-07-16 08:30",
  );
  // Attribution is left out of the fold: at this width a third field truncated
  // the two beside it. The kebab still reaches it.
  expect(lines?.[1]?.textContent).toBe("Change: —Notes: Before breakfast");
  expect(
    lines?.[1]?.classList.contains("mini-app-compact-table-line--muted"),
  ).toBe(true);
  expect(view.queryByText("2026-07-16 08:30 by you")).toBeNull();
  expect(view.getByRole("button", { name: "Entry 1 actions" })).toBeTruthy();
});

test("phone tracker table takes the two-line pitch on its frame", () => {
  const view = renderFoldedWeightTable();
  const frame = view.container.querySelector(".tracker-read-table");

  expect(frame?.classList.contains("mini-app-table-frame--two-line")).toBe(
    true,
  );
  expect(
    frame instanceof HTMLElement
      ? frame.style.getPropertyValue("--mini-app-virtual-row-height")
      : null,
  ).toBe("56px");
});

test("phone tracker table sorts from the folded header's select menu", () => {
  const view = renderFoldedWeightTable();
  const weights = () =>
    Array.from(view.container.querySelectorAll(".tracker-read-table-row")).map(
      (row) =>
        row.querySelector(".mini-app-compact-table-field")?.textContent ?? "",
    );

  expect(weights()).toEqual(["Weight: 180.5 lb", "Weight: 179 lb"]);

  const trigger = view.getByRole("combobox", {
    name: "Sort entries: Entry order, sorted ascending",
  });
  fireEvent.click(trigger);
  fireEvent.click(view.getByRole("option", { name: "Weight" }));

  expect(weights()).toEqual(["Weight: 179 lb", "Weight: 180.5 lb"]);
});
