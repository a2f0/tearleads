import {
  type RegisterDatabaseWorkerOptions,
  registerDatabaseWorker as registerDatabaseWorkerRuntime,
} from "./workerCore";

export type { RegisterDatabaseWorkerOptions } from "./workerCore";

export function registerDatabaseWorker(
  options: RegisterDatabaseWorkerOptions = {},
): void {
  registerDatabaseWorkerRuntime(self, options);
}
