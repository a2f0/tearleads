import {
  DisplayProperties,
  useWindowContentSize,
  type WindowSize,
} from "@tearleads/windowing";
import { useLayoutEffect, useRef, useState } from "react";
import { AppWindow } from "../AppWindow";
import "./SettingsApp.css";
import { MINI_APP_MENU_ITEMS } from "../catalog";
import { useVisibleMiniAppItems } from "../useVisibleMiniAppItems";

// Wallpaper, theme, and tray preferences come from the app-wide providers
// in Layout, so Settings can open before an identity or database exists.
export function SettingsApp() {
  const menuItems = useVisibleMiniAppItems(MINI_APP_MENU_ITEMS);
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentSize, setContentSize] = useState<WindowSize>();
  useWindowContentSize(contentSize);

  useLayoutEffect(() => {
    const element = contentRef.current;
    if (!element) return;
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      if (width === 0 || height === 0) return;
      setContentSize((previous) =>
        previous?.width === width && previous.height === height
          ? previous
          : { height, width },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <AppWindow>
      <div className="app-settings" ref={contentRef}>
        <DisplayProperties
          startMenuAppIds={menuItems.map(({ appId }) => appId)}
        />
      </div>
    </AppWindow>
  );
}
