import {
  DisplayProperties,
  useWindowContentSize,
  type WindowSize,
} from "@tearleads/windowing";
import { useLayoutEffect, useRef, useState } from "react";
import { AppWindow } from "../AppWindow";
import "./DisplayPropertiesApp.css";

// The windowing package's display settings: the desktop's wallpaper and the
// color theme. It reads the app-wide providers in Layout, so it needs no
// identity or database and opens from the pane's desktop menu at any time.
export function DisplayPropertiesApp() {
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentSize, setContentSize] = useState<WindowSize>();
  useWindowContentSize(contentSize);

  useLayoutEffect(() => {
    const element = contentRef.current;
    if (!element) return;
    const measure = () => {
      const { offsetWidth: width, offsetHeight: height } = element;
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
      <div className="app-display-properties" ref={contentRef}>
        <DisplayProperties />
      </div>
    </AppWindow>
  );
}
