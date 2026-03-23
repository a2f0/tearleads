import { expect, test } from "bun:test";
import { createDatabaseWorkerClient } from "../src/client";

type WorkerMessage = {
	id: number;
	method: string;
	params: unknown;
};

class MockWorker extends EventTarget {
	readonly messages: WorkerMessage[] = [];

	postMessage(message: WorkerMessage) {
		this.messages.push(message);
	}
}

test("destroy rejects pending requests and detaches listeners", async () => {
	const worker = new MockWorker();
	const client = createDatabaseWorkerClient(worker as unknown as Worker);

	const pendingPing = client.ping();
	expect(worker.messages).toHaveLength(1);

	client.destroy();

	expect(pendingPing).rejects.toThrow(
		"Database worker client has been destroyed.",
	);

	worker.dispatchEvent(
		new MessageEvent("message", {
			data: {
				id: worker.messages[0]?.id ?? 1,
				result: {
					ok: true,
					message: "pong",
				},
			},
		}),
	);

	expect(client.ping()).rejects.toThrow(
		"Database worker client has been destroyed.",
	);
});
