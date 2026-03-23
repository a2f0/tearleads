import {
  registerDatabaseWorker as registerDatabaseWorkerRuntime,
  type RegisterDatabaseWorkerOptions,
} from "./workerCore";

export type { RegisterDatabaseWorkerOptions } from "./workerCore";

export function registerDatabaseWorker(
  options: RegisterDatabaseWorkerOptions = {},
): void {
  registerDatabaseWorkerRuntime(self, options);
}
