import { ApplicationMenu, Utils } from "electrobun/bun";

export function installApplicationMenu(appName: string): void {
  // Linux forwards menu roles as actions instead of handling quit natively.
  ApplicationMenu.on("application-menu-clicked", (event) => {
    if (typeof event !== "object" || event === null || !("data" in event))
      return;
    const { data } = event;
    if (
      typeof data === "object" &&
      data !== null &&
      "action" in data &&
      data.action === "quit"
    ) {
      Utils.quit();
    }
  });

  ApplicationMenu.setApplicationMenu([
    // macOS reserves the first menu for the application name.
    ...(process.platform === "darwin"
      ? [
          {
            label: appName,
            submenu: [{ role: "quit", accelerator: "CommandOrControl+Q" }],
          },
        ]
      : []),
    {
      label: "File",
      submenu: [{ role: "quit", accelerator: "CommandOrControl+Q" }],
    },
    // WKWebView needs native Edit roles to enable its text-editing shortcuts.
    ...(process.platform === "darwin"
      ? [
          {
            label: "Edit",
            submenu: [
              { role: "undo" },
              { role: "redo" },
              { type: "separator" as const },
              { role: "cut" },
              { role: "copy" },
              { role: "paste" },
              { role: "selectAll" },
            ],
          },
        ]
      : []),
  ]);
}
