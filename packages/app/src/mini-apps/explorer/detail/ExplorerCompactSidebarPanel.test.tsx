import { afterEach, expect, test } from "bun:test";
import type { BlobInfo, BlobStore, ContainerNode } from "@tearleads/client-sdk";
import { createDomainScope } from "@tearleads/client-sdk";
import { cleanup, render, waitFor } from "@testing-library/react";
import { type ReactNode, useState } from "react";
import { WindowStateProvider } from "../../../components/window/WindowStateProvider";
import { AppNavigationProvider } from "../../../navigation/AppNavigationProvider";
import type { MiniAppDefinition, MiniAppId } from "../../types";
import { EXPLORER_LABELS } from "../labels";
import type { ExplorerRoute } from "../routes";
import { useExplorerCompactSidebarPanel } from "./ExplorerCompactSidebarPanel";

const TEST_MINI_APPS = {} as Readonly<Record<MiniAppId, MiniAppDefinition>>;
const DEFAULT_ROUTE: ExplorerRoute = { view: "selection" };
const DOMAIN_SCOPE = createDomainScope();
const EMPTY_NODES: ReadonlyArray<ContainerNode> = [];
const BLOB_STORE: BlobStore = {
  deleteBytes: async () => undefined,
  readBytes: async () => null,
  writeBytes: async () => undefined,
};

const loadBlobInfo = async () => ({ rows: [], totalCount: 0 });
const noop = () => undefined;
const noopBlob = (_blob: BlobInfo) => undefined;
const noopOpenBlobBrowserRoute = () => undefined;
const noopOpenDocumentInfoRoute = () => undefined;
const noopOpenSyncLaneDetailRoute = () => undefined;
const noopSelectDocumentProjection = () => undefined;

afterEach(cleanup);

function forceMobileRoutedTier(): () => void {
  const originalMatchMedia = window.matchMedia;

  window.matchMedia = ((query: string) => ({
    addEventListener: () => undefined,
    addListener: () => undefined,
    dispatchEvent: () => false,
    matches: false,
    media: query,
    onchange: null,
    removeEventListener: () => undefined,
    removeListener: () => undefined,
  })) as unknown as typeof window.matchMedia;

  return () => {
    window.matchMedia = originalMatchMedia;
  };
}

function CompactSidebarHarness() {
  const [sidebar, setSidebar] = useState<ReactNode>(null);

  useExplorerCompactSidebarPanel({
    blobPickTarget: null,
    blobStore: BLOB_STORE,
    databaseError: false,
    domainScope: DOMAIN_SCOPE,
    loadBlobInfo,
    nodes: EMPTY_NODES,
    onCancelBlobPick: noop,
    onOpenSyncLaneDetailRoute: noopOpenSyncLaneDetailRoute,
    onPickBlob: noopBlob,
    onRetryDatabase: noop,
    online: true,
    openBlobBrowserRoute: noopOpenBlobBrowserRoute,
    openDocumentInfoRoute: noopOpenDocumentInfoRoute,
    openSyncLanesRoute: noop,
    route: DEFAULT_ROUTE,
    selectDocumentProjection: noopSelectDocumentProjection,
    setSidebar,
  });

  return <div>{sidebar}</div>;
}

function renderCompactSidebar(mode: "routed" | "windowed") {
  return render(
    <WindowStateProvider>
      <AppNavigationProvider mode={mode} miniApps={TEST_MINI_APPS}>
        <CompactSidebarHarness />
      </AppNavigationProvider>
    </WindowStateProvider>,
  );
}

test("routed mobile registers the compact Explorer sidebar", async () => {
  const restoreMatchMedia = forceMobileRoutedTier();
  let view: ReturnType<typeof renderCompactSidebar> | undefined;

  try {
    view = renderCompactSidebar("routed");

    await waitFor(() => {
      expect(
        view?.getByRole("tab", { name: EXPLORER_LABELS.syncLanesAction }),
      ).toBeTruthy();
    });
    expect(
      view
        .getByRole("tab", { name: EXPLORER_LABELS.syncLanesAction })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      view.getByRole("tab", { name: EXPLORER_LABELS.blobBrowserAction }),
    ).toBeTruthy();
  } finally {
    view?.unmount();
    restoreMatchMedia();
  }
});

test("windowed mobile does not register the compact Explorer sidebar", () => {
  const restoreMatchMedia = forceMobileRoutedTier();
  let view: ReturnType<typeof renderCompactSidebar> | undefined;

  try {
    view = renderCompactSidebar("windowed");

    expect(
      view.queryByRole("tab", { name: EXPLORER_LABELS.syncLanesAction }),
    ).toBeNull();
  } finally {
    view?.unmount();
    restoreMatchMedia();
  }
});
