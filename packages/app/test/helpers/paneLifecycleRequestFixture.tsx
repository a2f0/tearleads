import { expect } from "bun:test";
import type { Tearleads } from "@tearleads/client-sdk";
import { fireEvent, waitFor, within } from "@testing-library/react";
import invariant from "invariant";
import { useEffect } from "react";
import type { AppHostConfig } from "../../src/host/AppHostConfig";
import {
  saveSystemMonitorMode,
  systemMonitorModeStorageKey,
} from "../../src/mini-apps/system-monitor/systemMonitorMode";
import { DeveloperModeProvider } from "../../src/providers/developer-mode/DeveloperModeProvider";
import { useTearleads } from "../../src/providers/sdk/TearleadsProvider";
import {
  DualPaneProvider,
  PaneSideProvider,
} from "../../src/shell/pane/dual-pane";
import { PaneProvider } from "../../src/shell/pane/runtime/PaneProvider";
import { Pane } from "../../src/shell/pane/shell/Pane";
import { AppTestRuntimeScopeProbe } from "./appRuntimeIdle";
import {
  getPaneRoot,
  interact,
  provisionPaneFromMenu,
  selectContainerAndWaitForItemTable,
} from "./dual-pane/dualPaneCore";
import {
  createChildContainer,
  createNoteInContainer,
  openExplorer,
} from "./dual-pane/dualPaneExplorerKit";
import { waitForPaneRuntimeToSettle } from "./paneTestUtils";
import { renderEmptyDesktop } from "./renderEmptyDesktop";
import { waitForPersonalBootstrap } from "./waitForPersonalBootstrap";

export function renderLifecyclePane(
  hostConfig: AppHostConfig,
  side: "left" | "right" = "left",
) {
  let sdk: Tearleads | null = null;
  function Probe() {
    const instance = useTearleads();
    useEffect(() => {
      sdk = instance;
    }, [instance]);
    return <AppTestRuntimeScopeProbe />;
  }
  saveSystemMonitorMode(systemMonitorModeStorageKey(side), "pinned");
  const view = renderEmptyDesktop(
    <DeveloperModeProvider>
      <DualPaneProvider>
        <PaneSideProvider side={side}>
          <PaneProvider hostConfig={hostConfig}>
            <Probe />
            <Pane className={`pane pane-${side}`} />
          </PaneProvider>
        </PaneSideProvider>
      </DualPaneProvider>
    </DeveloperModeProvider>,
  );
  return {
    view,
    pane: getPaneRoot(view, side),
    get sdk(): Tearleads {
      invariant(sdk, "Expected the mounted pane SDK");
      return sdk;
    },
  };
}

export async function waitForLifecycleConnection(sdk: Tearleads) {
  await waitFor(
    () => {
      expect(sdk.events.connected).toBe(true);
      expect(sdk.events.connectionGeneration).toBeGreaterThan(0);
    },
    { timeout: 20_000 },
  );
}

export async function expectNoPendingPaneWrites(sdk: Tearleads) {
  await waitFor(
    async () => {
      expect(
        await sdk.containerContents.documentQueries().listPendingWrites(),
      ).toEqual([]);
    },
    { timeout: 20_000 },
  );
}

export async function provisionLifecyclePane(
  mounted: ReturnType<typeof renderLifecyclePane>,
) {
  await provisionPaneFromMenu(mounted.pane);
  await waitForPersonalBootstrap();
  await waitForLifecycleConnection(mounted.sdk);
  await openExplorer(mounted.pane);
  for (const name of ["Lifecycle A", "Lifecycle B"]) {
    await createChildContainer(mounted.pane, name);
    await createNoteInContainer(mounted.pane, name, `${name} note`);
  }
  await selectContainerAndWaitForItemTable(mounted.pane, "/");
  await expectNoPendingPaneWrites(mounted.sdk);
  await waitForPaneRuntimeToSettle();
}

export async function waitForLifecycleNotesHydration(sdk: Tearleads) {
  const view = sdk.deviceFirst.open().view;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error("Lifecycle notes did not hydrate"));
    }, 20_000);
    const check = () => {
      const snapshot = view.getSnapshot();
      const hydrated = ["Lifecycle A", "Lifecycle B"].every((name) => {
        const folder = snapshot.containers.find((node) => node.name === name);
        return (
          folder &&
          snapshot.documentSummariesByContainerId
            .get(folder.id)
            ?.some((note) => note.title === `${name} note`)
        );
      });
      if (hydrated) {
        clearTimeout(timeout);
        unsubscribe();
        resolve();
      }
    };
    const unsubscribe = view.subscribe(check);
    check();
  });
}

export async function expectCachedLifecycleNotes(sdk: Tearleads) {
  for (const name of ["Lifecycle A", "Lifecycle B"]) {
    const folder = sdk.deviceFirst
      .open()
      .containerStore.getSnapshot()
      .nodes.find((node) => node.name === name);
    invariant(folder, `Expected cached folder ${name}`);
    const window = await sdk.containerContents
      .documentQueries()
      .listContainerDocumentSidebarWindow({
        containerId: folder.id,
        limit: 10,
        offset: 0,
      });
    expect(window.rows.map((row) => row.title)).toEqual([`${name} note`]);
    expect(window.rows.every((row) => row.documentId !== null)).toBe(true);
  }
}

export async function setLifecycleNetworkMode(
  mounted: ReturnType<typeof renderLifecyclePane>,
  offline: boolean,
) {
  const status = within(mounted.pane).getByRole("region", {
    name: "System status",
  });
  await interact(() =>
    fireEvent.contextMenu(status, { clientX: 30, clientY: 30 }),
  );
  await interact(() =>
    fireEvent.click(
      within(document.body).getByRole("button", {
        name: offline ? "Force Offline" : "Use Automatic Network",
      }),
    ),
  );
  await waitFor(() => expect(mounted.sdk.events.connected).toBe(!offline));
}
