import { expect, test } from "bun:test";

function onceMessage(worker: Worker): Promise<unknown> {
	return new Promise((resolve, reject) => {
		worker.addEventListener("message", (event) => resolve(event.data), {
			once: true,
		});
		worker.addEventListener("error", reject, { once: true });
	});
}

test("worker responds to ping", async () => {
	const worker = new Worker(new URL("./testWorker.ts", import.meta.url).href);

	worker.postMessage({
		id: 1,
		method: "ping",
		params: undefined,
	});

	expect(await onceMessage(worker)).toEqual({
		id: 1,
		result: {
			ok: true,
			message: "pong",
		},
	});

	worker.terminate();
});

test("worker responds to init", async () => {
	const worker = new Worker(new URL("./testWorker.ts", import.meta.url).href);

	worker.postMessage({
		id: 2,
		method: "init",
		params: {
			dbName: "test.db",
			cipher: "sqlcipher",
			key: "secret",
		},
	});

	expect(await onceMessage(worker)).toEqual({
		id: 2,
		result: {
			ok: true,
		},
	});

	worker.terminate();
});
