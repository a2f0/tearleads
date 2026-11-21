import { afterEach, expect, test } from "bun:test";
import {
  type ContainerDocumentQueries,
  createDomainScope,
  type DomainScope,
  getOrCreateDomainSyncCoordinator,
  waitForDomainSyncCoordinatorToSettle,
} from "@tearleads/client-sdk";
import {
  useWindowRefreshMenuItem,
  useWindowRefreshMenuItemValue,
  WindowMenuProvider,
} from "@tearleads/windowing";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import type { ImportExplorerDroppedFiles } from "../../../../stores/explorer/useExplorerDroppedFileImport";
import { useExplorerUploadManager } from "../../hooks/useExplorerUploadManager";
import { ExplorerUploadsPanel } from "./ExplorerUploadsPanel";

afterEach(cleanup);

function ToolbarProbe() {
  const refresh = useWindowRefreshMenuItemValue();
  return refresh ? (
    <button disabled={refresh.disabled} onClick={refresh.onClick} type="button">
      {refresh.label}
    </button>
  ) : null;
}

function ExplorerRefresh(params: { onRefresh: () => void }) {
  useWindowRefreshMenuItem({ onRefresh: params.onRefresh, priority: 100 });
  return null;
}

interface HarnessProps {
  documentQueries: ContainerDocumentQueries;
  domainScope: DomainScope;
  importDroppedFiles: ImportExplorerDroppedFiles;
  onExplorerRefresh?: () => void;
  online?: boolean;
  showUploads?: boolean;
  startRef: { current: (files: ReadonlyArray<File>) => void };
}

// The manager lives above the tabs, as in Explorer, so switching tabs keeps it.
function Harness(props: HarnessProps) {
  const manager = useExplorerUploadManager({
    documentQueries: props.documentQueries,
    domainScope: props.domainScope,
    importDroppedFiles: props.importDroppedFiles,
  });
  props.startRef.current = (files) => manager.startImport("folder", files);
  return (
    <WindowMenuProvider>
      <ExplorerRefresh onRefresh={props.onExplorerRefresh ?? (() => {})} />
      {props.showUploads === false ? null : (
        <ExplorerUploadsPanel
          domainScope={props.domainScope}
          isAuthenticated
          online={props.online ?? true}
          uploadManager={manager}
        />
      )}
      <ToolbarProbe />
    </WindowMenuProvider>
  );
}

function createUploadWorld() {
  const domainScope = createDomainScope();
  const synced = new Set<string>();
  const documentQueries = {
    loadDocumentSyncState: async (localId: string) => ({
      lastError: null,
      pendingAttachmentBytes: synced.has(localId) ? 0 : 1024,
      pendingAttachmentCount: synced.has(localId) ? 0 : 1,
      pendingUpdateCount: 0,
      status: synced.has(localId) ? "synced" : "pending",
    }),
  } as unknown as ContainerDocumentQueries;
  const imports: string[] = [];
  // Sync is not kicked on import here, so the toolbar Refresh starts it.
  const importDroppedFiles: ImportExplorerDroppedFiles = async (
    _containerId,
    files,
    options,
  ) => {
    files.forEach((file, index) => {
      imports.push(file.name);
      const localId = file.name.replace(".txt", "");
      options?.onFileImported?.({
        fileIndex: index,
        localId,
        requestSync: () => undefined,
        storageKeys: [`blob-${localId}`],
      });
    });
    return {
      aborted: false,
      completedCount: files.length,
      failedCount: 0,
      importedCount: files.length,
      importedDocuments: [],
      totalCount: files.length,
    };
  };
  const coordinator = getOrCreateDomainSyncCoordinator(domainScope);
  coordinator.registerLane("documents:alpha", {
    run: async () => {
      synced.add("alpha");
    },
  });
  coordinator.registerLane("documents:beta", { run: async () => undefined });
  // Beta's attachment is half sent.
  coordinator
    .beginUploadLane("blob-upload:beta", { blobStorageKey: "blob-beta" })
    .reportProgress({
      bytesTotal: 1024,
      bytesUploaded: 512,
      partsCompleted: 1,
      partsTotal: 2,
    });
  return { documentQueries, domainScope, importDroppedFiles, imports };
}

async function refreshAndSettle(
  view: ReturnType<typeof render>,
  domainScope: DomainScope,
) {
  await act(async () => {
    fireEvent.click(view.getByRole("button", { name: "Refresh" }));
    await waitForDomainSyncCoordinatorToSettle(domainScope, {
      quietMs: 0,
      timeoutMs: 1_000,
    });
  });
}

function expectRow(
  view: ReturnType<typeof render>,
  name: string,
  expected: { percent: string; status: string },
) {
  const row = view.getByText(name).closest("tr");
  if (!(row instanceof HTMLElement)) throw new Error(`No row for ${name}`);
  expect(within(row).getByText(expected.status)).toBeTruthy();
  expect(
    within(row).getByRole("progressbar").getAttribute("aria-valuenow"),
  ).toBe(expected.percent);
}

test("the first file to finish stays Complete across a tab switch and refresh", async () => {
  const world = createUploadWorld();
  const startRef = { current: (_files: ReadonlyArray<File>) => {} };
  const props = { ...world, startRef };
  const view = render(<Harness {...props} />);
  act(() =>
    startRef.current([
      new File(["Alpha"], "alpha.txt", { type: "text/plain" }),
      new File(["Beta"], "beta.txt", { type: "text/plain" }),
    ]),
  );
  await waitFor(() =>
    expect(view.getByText("2 files · 2 in progress")).toBeTruthy(),
  );
  // Transferred bytes drive Beta's bar before sync is even requested.
  expectRow(view, "beta.txt", { percent: "50", status: "Pending sync" });
  expect(view.getByText("1/2 parts · 512 B / 1.0 KB")).toBeTruthy();

  await refreshAndSettle(view, world.domainScope);
  await waitFor(() =>
    expectRow(view, "alpha.txt", { percent: "100", status: "Complete" }),
  );
  expectRow(view, "beta.txt", { percent: "50", status: "Pending sync" });
  expect(view.getByText("2 files · 1 in progress")).toBeTruthy();

  // Switch to Downloads and back, then refresh again.
  view.rerender(<Harness {...props} showUploads={false} />);
  expect(view.queryByText("alpha.txt")).toBeNull();
  view.rerender(<Harness {...props} />);
  await refreshAndSettle(view, world.domainScope);
  expect(view.getAllByText("alpha.txt")).toHaveLength(1);
  expectRow(view, "alpha.txt", { percent: "100", status: "Complete" });
  expect(view.getAllByText("Complete")).toHaveLength(1);
  expect(view.getByText("2 files · 1 in progress")).toBeTruthy();
  // Refresh re-drove the existing uploads; nothing was imported again.
  expect(world.imports).toEqual(["alpha.txt", "beta.txt"]);
});

test("Uploads owns the toolbar Refresh while open and keeps it off offline", async () => {
  const world = createUploadWorld();
  const startRef = { current: (_files: ReadonlyArray<File>) => {} };
  let explorerRefreshes = 0;
  const props = {
    ...world,
    onExplorerRefresh: () => {
      explorerRefreshes += 1;
    },
    startRef,
  };
  const view = render(<Harness {...props} online={false} />);
  expect(
    view.getByRole("button", { name: "Refresh" }).hasAttribute("disabled"),
  ).toBe(true);
  view.rerender(<Harness {...props} />);
  await refreshAndSettle(view, world.domainScope);
  expect(explorerRefreshes).toBe(0);
  view.rerender(<Harness {...props} showUploads={false} />);
  fireEvent.click(view.getByRole("button", { name: "Refresh" }));
  expect(explorerRefreshes).toBe(1);
});
