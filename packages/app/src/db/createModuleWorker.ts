export interface ModuleWorkerLike extends EventTarget {
	postMessage(message: unknown): void;
	addEventListener: Worker["addEventListener"];
	removeEventListener: Worker["removeEventListener"];
	terminate(): void;
}

export interface ModuleWorkerConstructor {
	new (scriptURL: string | URL, options?: WorkerOptions): ModuleWorkerLike;
}

export function createModuleWorker(
	workerUrl: URL,
	WorkerCtor: ModuleWorkerConstructor = globalThis.Worker,
): ModuleWorkerLike {
	return new WorkerCtor(workerUrl, { type: "module" });
}
