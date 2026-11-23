import {
  createDomainScope,
  getDomainSyncCoordinatorSnapshot,
} from "@tearleads/client-sdk";
import { type RenderResult, render } from "@testing-library/react";
import type { ComponentProps } from "react";
import { ExplorerOutgoingView } from "../../../src/mini-apps/explorer/detail/transfers/ExplorerOutgoingPanel";
import { ARCHIVE_NODE, uploadManager } from "./syncPanelFixtures";

export type OutgoingViewProps = ComponentProps<typeof ExplorerOutgoingView>;

const EMPTY_SNAPSHOT = getDomainSyncCoordinatorSnapshot(createDomainScope());

/** The Outgoing tab's view, from what its panel would have read. */
export function renderOutgoingView(
  overrides: Partial<OutgoingViewProps> = {},
): RenderResult {
  const props: OutgoingViewProps = {
    billingBlockedOrganizationId: null,
    discardPendingWrites: () => undefined,
    error: null,
    isAuthenticated: true,
    loading: false,
    nodes: [ARCHIVE_NODE],
    online: true,
    openContainerInfoRoute: () => undefined,
    openDocument: () => undefined,
    openWriteQueueEntryRoute: () => undefined,
    organizationNamesById: new Map([
      ["custom-org", "Acme"],
      ["personal-org", "Personal"],
    ]),
    retryPendingWrites: () => undefined,
    selectedEntryKey: null,
    snapshot: EMPTY_SNAPSHOT,
    uploadManager: uploadManager(),
    writes: [],
    ...overrides,
  };
  return render(<ExplorerOutgoingView {...props} />);
}

/** The table row holding `element`, such as a row's open button. */
export function rowFor(element: HTMLElement): HTMLTableRowElement {
  const row = element.closest("tr");
  if (!(row instanceof HTMLTableRowElement)) {
    throw new Error("Expected the element to be inside a table row.");
  }
  return row;
}
