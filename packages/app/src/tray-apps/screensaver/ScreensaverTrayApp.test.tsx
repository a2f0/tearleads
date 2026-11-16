import { afterEach, expect, test } from "bun:test";
import { LaserScreensaver, ScreensaverProvider } from "@tearleads/windowing";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { ScreensaverTrayApp } from "./ScreensaverTrayApp";

afterEach(cleanup);

test("starts the hosted screensaver", () => {
  const view = render(
    <ScreensaverProvider screensaver={LaserScreensaver}>
      <ScreensaverTrayApp />
    </ScreensaverProvider>,
  );

  fireEvent.click(view.getByRole("button", { name: "Start Screensaver" }));

  expect(view.getByRole("dialog")).toBeTruthy();
});

test("isolated peer surfaces do not expose a screensaver without the shared host", () => {
  const view = render(<ScreensaverTrayApp />);
  expect(view.queryByRole("button", { name: "Start Screensaver" })).toBeNull();
});
