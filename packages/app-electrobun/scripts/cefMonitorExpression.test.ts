import { expect, test } from "bun:test";
import { openSystemMonitorExpression } from "./cefMonitorExpression";

test("opens a closed launcher, opens the monitor, then keeps it open", () => {
  let launcherOpen = false;
  let monitorOpen = false;
  const clicks: string[] = [];
  const document = {
    querySelector(selector: string) {
      if (selector === ".system-monitor") return monitorOpen ? {} : null;
      if (
        selector ===
        '[aria-label="System Monitor"], a[href="/app/system-monitor"]'
      ) {
        return launcherOpen
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
});

test("tolerates the renderer before the launcher mounts", () => {
  const poll = new Function("document", openSystemMonitorExpression);
  expect(() => poll({ querySelector: () => null })).not.toThrow();
});
