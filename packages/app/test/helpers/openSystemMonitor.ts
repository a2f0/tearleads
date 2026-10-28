import { fireEvent, type RenderResult } from "@testing-library/react";
import { clickPaneAppMenuItem } from "./paneTestUtils";

export function openSystemMonitor(view: RenderResult) {
  fireEvent.click(view.getByRole("button", { name: "Menu" }));
  clickPaneAppMenuItem(view, "System Monitor");
}
