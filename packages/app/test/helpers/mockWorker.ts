// Minimal worker test double for App.tsx. It implements only the behavior
// the component relies on: async ping/init responses and termination tracking.
export class MockWorker extends EventTarget {
  terminated = false;

  terminate() {
    this.terminated = true;
  }

  postMessage(message: { id: number; method: string }) {
    // Mirror just enough of the worker protocol for component tests.
    if (message.method !== "ping" && message.method !== "init") {
      return;
    }

    queueMicrotask(() => {
      this.dispatchEvent(
        new MessageEvent("message", {
          data: {
            id: message.id,
            result:
              message.method === "ping"
                ? {
                    ok: true,
                    message: "pong",
                  }
                : {
                    ok: true,
                  },
          },
        }),
      );
    });
  }
}
