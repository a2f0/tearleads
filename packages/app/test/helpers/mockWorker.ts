import type {
  WorkerRequest,
  WorkerResponse,
} from "@tearleads/sqlite-worker/types";
import { handleRequest } from "@tearleads/sqlite-worker/worker-core";

// Minimal worker test double for App.tsx. It uses the shared sqlite worker
// protocol so test behavior stays aligned with the real worker contract.
export class MockWorker extends EventTarget {
  terminated = false;

  constructor(_scriptURL?: string | URL, _options?: WorkerOptions) {
    super();
  }

  terminate() {
    this.terminated = true;
  }

  postMessage(message: WorkerRequest) {
    queueMicrotask(async () => {
      const response = (await handleRequest(message, {
        onInit: async () => {},
      })) satisfies WorkerResponse;

      this.dispatchEvent(
        new MessageEvent<WorkerResponse>("message", {
          data: response,
        }),
      );
    });
  }
}
