import { expect, test } from "bun:test";
import { openSystemMonitorExpression } from "./cefMonitorExpression";

test.each(["windowed", "routed"])(
  "opens the %s launcher and keeps the monitor open",
  (mode) => {
    let launcherOpen = false;
    let monitorOpen = false;
    const clicks: string[] = [];
    const document = {
      querySelectorAll(selector: string) {
        expect(selector).toBe(".menu button");
        return launcherOpen && mode === "windowed"
          ? [
              { textContent: "Explorer" },
              {
                textContent: " System Monitor ",
                click() {
                  clicks.push("monitor");
                  monitorOpen = !monitorOpen;
                },
              },
            ]
          : [];
      },
      querySelector(selector: string) {
        if (selector === ".system-monitor") return monitorOpen ? {} : null;
        if (selector === 'a[href="/app/system-monitor"]') {
          return launcherOpen && mode === "routed"
            ? {
                click() {
                  clicks.push("monitor");
                  monitorOpen = !monitorOpen;
                },
              }
            : null;
        }
        if (selector === '[aria-label="Menu"][aria-expanded="false"]') {
          return launcherOpen
            ? null
            : {
                click() {
                  clicks.push("menu");
                  launcherOpen = true;
                },
              };
        }
        throw new Error(`Unexpected selector: ${selector}`);
      },
    };
    const poll = new Function("document", openSystemMonitorExpression);
    poll(document);
    expect(clicks).toEqual(["menu"]);
    poll(document);
    expect(clicks).toEqual(["menu", "monitor"]);
    poll(document);
    expect(clicks).toEqual(["menu", "monitor"]);
    expect(monitorOpen).toBe(true);
  },
);

test("tolerates the renderer before the launcher mounts", () => {
  const poll = new Function("document", openSystemMonitorExpression);
  expect(() =>
    poll({ querySelector: () => null, querySelectorAll: () => [] }),
  ).not.toThrow();
});
