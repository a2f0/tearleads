import type { ModuleWorkerConstructor, ModuleWorkerLike } from "./types";

// Creates an ES module worker while keeping the constructor injectable for
// tests and non-browser hosts that need to provide their own Worker class.
export function createModuleWorker(
  workerUrl: string | URL,
  workerConstructor: ModuleWorkerConstructor = globalThis.Worker,
): ModuleWorkerLike {
  return new workerConstructor(workerUrl, { type: "module" });
}
