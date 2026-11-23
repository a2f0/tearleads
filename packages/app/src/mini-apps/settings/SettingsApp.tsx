import {
  DisplayProperties,
  useMiniAppRouteSegments,
  useWindowContentSize,
  type WindowSize,
} from "@tearleads/windowing";
import { useId, useLayoutEffect, useRef, useState } from "react";
import {
  MiniAppTabList,
  MiniAppTabPanel,
} from "../../components/mini-app/layout/MiniAppTabs";
import { AppWindow } from "../AppWindow";
import "./SettingsApp.css";
import { MINI_APP_MENU_ITEMS } from "../catalog";
import { useVisibleMiniAppItems } from "../useVisibleMiniAppItems";
import { NetworkSettings } from "./NetworkSettings";

const SETTINGS_TABS = [
  { id: "desktop", label: "Desktop" },
  { id: "system-tray", label: "System tray" },
  { id: "start-menu", label: "Start menu" },
  { id: "network", label: "Network" },
] as const;

// Wallpaper, theme, and tray preferences come from the app-wide providers
// in Layout, so Settings can open before an identity or database exists.
export function SettingsApp() {
  const idPrefix = useId();
  const { pathSegments, setPathSegments } =
    useMiniAppRouteSegments("display-properties");
  const activeTab =
    SETTINGS_TABS.find(({ id }) => id === pathSegments[0])?.id ?? "desktop";
  const menuItems = useVisibleMiniAppItems(MINI_APP_MENU_ITEMS);
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentSize, setContentSize] = useState<WindowSize>();
  useWindowContentSize(contentSize);

  // The natural size Fit to Content sizes the window to. Its width is the
  // panel's (SettingsApp.css), since the tab strip spans whatever width the
  // window has. A leading strip sits in the window body's top padding, so that
  // part of the height is already provided by the padding and is not counted.
  useLayoutEffect(() => {
    const element = contentRef.current;
    const panel = element?.querySelector(':scope > [role="tabpanel"]');
    const strip = element?.querySelector(':scope > [role="tablist"]');
    if (!element || !panel || !strip) return;
    const measure = () => {
      const { width } = panel.getBoundingClientRect();
      const tucked = Number.parseFloat(getComputedStyle(strip).marginTop) || 0;
      const height = element.getBoundingClientRect().height + tucked;
      if (width === 0 || height <= 0) return;
      setContentSize((previous) =>
        previous?.width === width && previous.height === height
          ? previous
          : { height, width },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    observer.observe(panel);
    return () => observer.disconnect();
  }, []);

  return (
    <AppWindow>
      <div className="app-settings" ref={contentRef}>
        <MiniAppTabList
          activeTab={activeTab}
          idPrefix={idPrefix}
          label="Settings"
          leading
          onSelect={(tab) => setPathSegments(tab === "desktop" ? [] : [tab])}
          tabs={SETTINGS_TABS}
        />
        <MiniAppTabPanel activeTab={activeTab} idPrefix={idPrefix}>
          {activeTab === "network" ? (
            <NetworkSettings />
          ) : (
            <DisplayProperties
              section={activeTab}
              startMenuAppIds={menuItems.map(({ appId }) => appId)}
            />
          )}
        </MiniAppTabPanel>
      </div>
    </AppWindow>
  );
}
