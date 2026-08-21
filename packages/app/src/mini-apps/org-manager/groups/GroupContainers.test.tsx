import { afterEach, expect, test } from "bun:test";
import type { OrganizationGroupContainer } from "@symcrypt/client-sdk";
import { cleanup, render, within } from "@testing-library/react";
import { ROUTED_TABLET_QUERY } from "../../../navigation/breakpoints";
import { formatMiniAppDate } from "../../../utils/formatMiniAppDate";
import { ORG_MANAGER_LABELS } from "../labels";
import { GroupContainers } from "./GroupContainers";

const originalMatchMedia = window.matchMedia;

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-navigation-mode");
  globalThis.localStorage.clear();
  window.matchMedia = originalMatchMedia;
});

function usePhoneLayout() {
  window.matchMedia = ((query: string) => ({
    addEventListener: () => undefined,
    addListener: () => undefined,
    dispatchEvent: () => true,
    matches: query !== ROUTED_TABLET_QUERY,
    media: query,
    onchange: null,
    removeEventListener: () => undefined,
    removeListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
  document.documentElement.setAttribute("data-navigation-mode", "routed");
}

const container = {
  accessLevel: "write",
  containerDisplayName: "Roadmap",
  containerId: "550e8400-e29b-41d4-a716-446655440020",
  createdAt: "2026-05-20T12:00:00.000Z",
  depth: 1,
  isBuiltin: false,
  metadataAccessEpoch: 2,
  metadataAccessStateHash: "access-state-hash",
  metadataDocumentId: null,
  parentId: "550e8400-e29b-41d4-a716-446655440021",
  updatedAt: "2026-05-21T12:00:00.000Z",
} satisfies OrganizationGroupContainer;

test("org manager group containers use two-line summaries on phone layouts", () => {
  usePhoneLayout();
  const view = render(<GroupContainers containers={[container]} />);
  const table = view.getByRole("table", {
    name: ORG_MANAGER_LABELS.directContainerLinks,
  });
  const summaries = table.querySelectorAll<HTMLElement>(
    ".mini-app-compact-table-lines",
  );

  expect(summaries).toHaveLength(2);
  const headerSummary = summaries.item(0);
  const headerLines = headerSummary.querySelectorAll<HTMLElement>(
    ".mini-app-compact-table-line",
  );
  expect(headerLines).toHaveLength(2);
  expect(
    within(headerLines.item(0)).getByText(ORG_MANAGER_LABELS.container),
  ).toBeTruthy();
  expect(
    within(headerLines.item(1)).getByText(ORG_MANAGER_LABELS.access),
  ).toBeTruthy();
  expect(
    within(headerLines.item(1)).getByText(ORG_MANAGER_LABELS.updated),
  ).toBeTruthy();

  const rowSummary = summaries.item(1);
  const rowLines = rowSummary.querySelectorAll<HTMLElement>(
    ".mini-app-compact-table-line",
  );
  expect(rowLines).toHaveLength(2);
  expect(
    Array.from(
      rowSummary.querySelectorAll(".mini-app-compact-table-field-label"),
      (label) => label.textContent?.trim(),
    ),
  ).toEqual(["Container:", "Access:", "Updated:"]);
  expect(
    within(rowLines.item(0))
      .getByText(container.containerDisplayName)
      .getAttribute("title"),
  ).toBe(`${container.containerDisplayName} (${container.containerId})`);
  expect(
    within(rowLines.item(1)).getByText(ORG_MANAGER_LABELS.accessWrite),
  ).toBeTruthy();
  expect(
    within(rowLines.item(1))
      .getByText(formatMiniAppDate(container.updatedAt))
      .getAttribute("title"),
  ).toBe(container.updatedAt);
  expect(
    view.getByRole("button", { name: ORG_MANAGER_LABELS.columns }),
  ).toBeTruthy();

  const frame = table.closest(".mini-app-table-frame");
  if (!(frame instanceof HTMLElement)) {
    throw new Error("Expected the group containers virtual table frame.");
  }
  expect(frame.classList.contains("mini-app-table-frame--two-line")).toBe(true);
  expect(frame.style.getPropertyValue("--mini-app-virtual-row-height")).toBe(
    "56px",
  );
});
