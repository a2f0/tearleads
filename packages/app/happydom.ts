import { GlobalWindow } from "happy-dom";

const window = new GlobalWindow();

for (const key of Object.keys(window)) {
  if (!(key in globalThis)) {
    (globalThis as Record<string, unknown>)[key] = (window as Record<string, unknown>)[key];
  }
}
