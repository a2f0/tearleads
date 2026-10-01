import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();

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
