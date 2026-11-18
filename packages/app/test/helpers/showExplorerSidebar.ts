import { act, fireEvent, within } from "@testing-library/react";

export async function showExplorerSidebar(explorerWindow: HTMLElement) {
  await act(async () => {
    fireEvent.click(
      within(explorerWindow).getByRole("menuitem", { name: "View" }),
    );
  });
  await act(async () => {
    fireEvent.click(
      within(explorerWindow).getByRole("menuitem", { name: "Show Sidebar" }),
    );
  });
}
