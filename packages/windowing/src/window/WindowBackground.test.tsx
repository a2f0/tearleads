import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { useWindowBackground } from "./CurrentWindowContext";
import { Window } from "./Window";
import {
  useWindowActions,
  useWindowStateData,
  WindowStateProvider,
} from "./WindowStateProvider";

const PAGE_SURROUND = "rgb(35, 35, 35)";

afterEach(() => {
  cleanup();
  document.head.replaceChildren();
});

function Page({ background }: { background: string | undefined }) {
  useWindowBackground(background);
  return <p>page</p>;
}

function ViewerContent() {
  const [open, setOpen] = useState(true);
  const [background, setBackground] = useState<string | undefined>(
    PAGE_SURROUND,
  );
  return (
    <>
      <button type="button" onClick={() => setBackground("rgb(230, 230, 230)")}>
        Light
      </button>
      <button type="button" onClick={() => setBackground(undefined)}>
        Default
      </button>
      <button type="button" onClick={() => setOpen(false)}>
        Close page
      </button>
      {open && <Page background={background} />}
    </>
  );
}

function NotesContent() {
  return <p>notes</p>;
}

function Desktop() {
  const { windows } = useWindowStateData();
  const { create } = useWindowActions();
  return (
    <>
      <button
        type="button"
        onClick={() => {
          create("Viewer", 0, 0, ViewerContent);
          create("Notes", 40, 40, NotesContent);
        }}
      >
        Open windows
      </button>
      {windows.map((entry) => (
        <Window key={entry.id} windowId={entry.id} />
      ))}
    </>
  );
}

function renderDesktop() {
  const view = render(
    <WindowStateProvider>
      <Desktop />
    </WindowStateProvider>,
  );
  fireEvent.click(view.getByRole("button", { name: "Open windows" }));
  return view;
}

function windowBackground(element: HTMLElement) {
  return element.style.getPropertyValue("--window-background");
}

test("content paints only its own window's background", () => {
  const view = renderDesktop();
  const viewer = view.getByRole("region", { name: "Viewer" });
  const notes = view.getByRole("region", { name: "Notes" });

  expect(windowBackground(viewer)).toBe(PAGE_SURROUND);
  expect(windowBackground(notes)).toBe("");

  fireEvent.click(view.getByRole("button", { name: "Light" }));
  expect(windowBackground(viewer)).toBe("rgb(230, 230, 230)");

  fireEvent.click(view.getByRole("button", { name: "Default" }));
  expect(windowBackground(viewer)).toBe("");
});

test("the window background reverts when its content unmounts", () => {
  const view = renderDesktop();
  const viewer = view.getByRole("region", { name: "Viewer" });

  fireEvent.click(view.getByRole("button", { name: "Close page" }));
  expect(windowBackground(viewer)).toBe("");
});

test("the window paints the content's background over its default", () => {
  const style = document.createElement("style");
  style.textContent = readFileSync(join(import.meta.dir, "Window.css"), "utf8");
  document.head.append(style);
  const view = renderDesktop();

  expect(
    getComputedStyle(view.getByRole("region", { name: "Viewer" }))
      .backgroundColor,
  ).toBe(PAGE_SURROUND);
});
