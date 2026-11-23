import { afterEach, expect, spyOn, test } from "bun:test";
import {
  type ContainerDocumentQueries,
  createDomainScope,
} from "@tearleads/client-sdk";
import { cleanup, render } from "@testing-library/react";
import type { ExplorerUploadManager } from "../../hooks/useExplorerUploadManager";
import type { ExplorerOutgoingSection } from "../../routes";
import { ExplorerOutgoingPanel } from "./ExplorerOutgoingPanel";

afterEach(cleanup);

const uploadManager: ExplorerUploadManager = {
  cancel: () => undefined,
  cancelForContainer: () => undefined,
  isImporting: false,
  items: [],
  queuedFileCount: 0,
  queuedFileCounts: new Map(),
  run: null,
  startImport: () => undefined,
};

const domainScope = createDomainScope();

function panel(input: {
  section: ExplorerOutgoingSection | null;
  selectedEntryKey?: string;
}) {
  return (
    <ExplorerOutgoingPanel
      billingBlockedOrganizationId={null}
      dbReady={false}
      documentQueries={{} as ContainerDocumentQueries}
      domainScope={domainScope}
      isAuthenticated
      nodes={[]}
      online
      openContainerInfoRoute={() => undefined}
      openDocument={() => undefined}
      openWriteQueueEntryRoute={() => undefined}
      organizationNamesById={new Map()}
      section={input.section}
      selectedEntryKey={input.selectedEntryKey ?? null}
      uploadManager={uploadManager}
    />
  );
}

// Happy DOM lays nothing out, so stand in the drawn tops: the panel's
// scrollport at 100px and each section at a fixed offset below it.
function layOut() {
  const tops: Record<string, number> = { uploads: 180, writes: 520 };
  return spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      const section = this.getAttribute("data-outgoing-section");
      const top = this.classList.contains("mini-app-panel--scroll")
        ? 100
        : (tops[section ?? ""] ?? 0);
      return DOMRect.fromRect({ height: 10, width: 10, x: 0, y: top });
    },
  );
}

function scrollTop(view: ReturnType<typeof render>): number {
  const scroller = view.container.querySelector(".mini-app-panel--scroll");
  if (!(scroller instanceof HTMLElement)) throw new Error("No scroller");
  return scroller.scrollTop;
}

test("a link to a section scrolls its heading to the top of the tab", () => {
  const rects = layOut();
  try {
    expect(scrollTop(render(panel({ section: "writes" })))).toBe(420);
    cleanup();
    expect(scrollTop(render(panel({ section: "uploads" })))).toBe(80);
  } finally {
    rects.mockRestore();
  }
});

test("the tab opens at its top without a section, and follows a later link", () => {
  const rects = layOut();
  try {
    const view = render(panel({ section: null }));
    expect(scrollTop(view)).toBe(0);
    view.rerender(panel({ section: "writes" }));
    expect(scrollTop(view)).toBe(420);
  } finally {
    rects.mockRestore();
  }
});

test("an entry's detail has no section to scroll to", () => {
  const rects = layOut();
  try {
    const view = render(
      panel({ section: "writes", selectedEntryKey: "document::local-1" }),
    );
    expect(scrollTop(view)).toBe(0);
    expect(view.container.querySelector("[data-outgoing-section]")).toBeNull();
  } finally {
    rects.mockRestore();
  }
});
