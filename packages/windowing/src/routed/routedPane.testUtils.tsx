import { AddressBookIcon } from "@phosphor-icons/react/dist/csr/AddressBook";
import { FolderIcon } from "@phosphor-icons/react/dist/csr/Folder";
import { NoteIcon } from "@phosphor-icons/react/dist/csr/Note";
import { type RenderResult, render } from "@testing-library/react";
import { LauncherNavigationProvider } from "../launcher/LauncherNavigationProvider";
import type { LauncherDefinition } from "../launcher/launcherDefinition";
import {
  useRegisteredWindowSidebar,
  useWindowSidebar,
} from "../window/WindowSidebarContext";
import { WindowStateProvider } from "../window/WindowStateProvider";
import { RoutedPane, type RoutedPaneProps } from "./RoutedPane";

const EXPLORER_SIDEBAR = <div>Explorer sidebar</div>;

function ExplorerProbe() {
  const { setSidebar } = useWindowSidebar();
  useRegisteredWindowSidebar({ setSidebar, sidebar: EXPLORER_SIDEBAR });
  return <div>Explorer content</div>;
}

function ContactsProbe() {
  return <div>Contacts content</div>;
}

function NotesProbe() {
  return <div>Notes content</div>;
}

export const TEST_LAUNCHER: LauncherDefinition = {
  apps: {
    contacts: {
      createComponent: () => ContactsProbe,
      icon: AddressBookIcon,
      title: "Contacts",
    },
    explorer: {
      createComponent: () => ExplorerProbe,
      icon: FolderIcon,
      title: "Explorer",
    },
    notes: {
      createComponent: () => NotesProbe,
      icon: NoteIcon,
      initialShowSidebar: false,
      title: "Notes",
    },
  },
  homeAppId: "explorer",
  order: ["explorer", "contacts", "notes"],
};

export const TEST_LAUNCHER_APP_COUNT = Object.keys(TEST_LAUNCHER.apps).length;

/** Renders the routed shell at the root route, which shows Explorer. */
export function renderRoutedPane(
  props: Partial<RoutedPaneProps> = {},
): RenderResult {
  window.history.replaceState(null, "", "/");

  return render(
    <WindowStateProvider>
      <LauncherNavigationProvider definition={TEST_LAUNCHER} mode="routed">
        <RoutedPane menuIcon={<svg aria-hidden="true" />} {...props} />
      </LauncherNavigationProvider>
    </WindowStateProvider>,
  );
}

// Forces the routed layout tier by stubbing matchMedia: mobile matches no
// query; tablet matches min-width queries. Returns a restore function.
export function forceMobileRoutedTier(): () => void {
  return forceRoutedTier(() => false);
}

export function forceTabletRoutedTier(): () => void {
  return forceRoutedTier((query) => query.includes("min-width"));
}

function forceRoutedTier(matches: (query: string) => boolean): () => void {
  const originalMatchMedia = window.matchMedia;

  window.matchMedia = (query: string): MediaQueryList => ({
    addEventListener: () => {},
    addListener: () => {},
    dispatchEvent: () => false,
    matches: matches(query),
    media: query,
    onchange: null,
    removeEventListener: () => {},
    removeListener: () => {},
  });

  return () => {
    window.matchMedia = originalMatchMedia;
  };
}
