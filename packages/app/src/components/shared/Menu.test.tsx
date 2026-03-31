import { afterEach, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { Menu } from "./Menu";
import { MenuItem } from "./MenuItem";

afterEach(() => cleanup());

test("renders into document.body so nested menus escape parent stacking contexts", () => {
  const view = render(
    <div data-testid="host">
      <Menu position={{ x: 24, y: 48 }} onClose={() => {}}>
        <MenuItem label="Open" onClick={() => {}} />
      </Menu>
    </div>,
  );

  const host = view.getByTestId("host");
  const item = view.getByText("Open");
  const menu = item.closest(".menu");

  expect(menu).toBeTruthy();
  expect(host.contains(item)).toBe(false);
  expect(document.body.contains(item)).toBe(true);
});
