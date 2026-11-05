import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();

// A failing assertion prints its received value through this hook; Bun's
// default dump of a happy-dom node walks the whole document graph and can run
// for minutes. Print nodes as their (truncated) markup instead. The app's
// preload installs the same hook (packages/app/test/helpers/compactDomInspect.ts).
const MAX_MARKUP = 1000;
Object.defineProperty(
  Node.prototype,
  Symbol.for("nodejs.util.inspect.custom"),
  {
    configurable: true,
    value(this: Node): string {
      const text =
        this instanceof Element
          ? this.outerHTML
          : `${this.nodeName} ${JSON.stringify(this.textContent)}`;
      return text.length > MAX_MARKUP
        ? `${text.slice(0, MAX_MARKUP)}... (${text.length} chars)`
        : text;
    },
  },
);

// happy-dom registers no ResizeObserver, while every production browser has
// one, so Menu constructs it unguarded. Tests that exercise resize behavior
// install their own observer over this stub.
if (typeof globalThis.ResizeObserver === "undefined") {
  class NoopResizeObserver {
    disconnect(): void {}
    observe(): void {}
    unobserve(): void {}
  }
  globalThis.ResizeObserver =
    NoopResizeObserver as unknown as typeof ResizeObserver;
}
