// Minimal worker test double for App.tsx. It implements only the behavior
// the component relies on: async ping responses and termination tracking.
export class MockWorker extends EventTarget {
  terminated = false;

  terminate() {
    this.terminated = true;
  }

  postMessage(message: { id: number; method: string }) {
    // Mirror just enough of the worker protocol for component tests:
    // a ping request yields the same success payload as the real worker.
    if (message.method !== "ping") {
      return;
    }

    queueMicrotask(() => {
      // Resolve asynchronously so tests exercise the effect's promise
      // chain and cleanup timing instead of a synchronous shortcut.
      this.dispatchEvent(
        new MessageEvent("message", {
          data: {
            id: message.id,
            result: {
              ok: true,
              message: "pong",
            },
          },
        }),
      );
    });
  }
}
