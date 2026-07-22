import { expect, test } from "bun:test";
import {
  type CreateModuleDatabaseRuntimeOptions,
  createDatabaseRuntime,
} from "@tearleads/sqlite-worker/runtime";
import {
  MockMessageChannel,
  MockWorker,
} from "../../../test/helpers/mockWorker";

const INIT_OPTIONS = {
  cipher: "aes256cbc" as const,
  dbName: `/mock-worker-${crypto.randomUUID()}.db`,
  key: "test-key",
};

class RecordingMessageChannel extends MockMessageChannel {
  static readonly instances: RecordingMessageChannel[] = [];

  constructor() {
    super();
    RecordingMessageChannel.instances.push(this);
  }
}

const recordingMessageChannelConstructor =
  RecordingMessageChannel as unknown as NonNullable<
    CreateModuleDatabaseRuntimeOptions["messageChannelConstructor"]
  >;
const mockMessageChannelConstructor =
  MockMessageChannel as unknown as NonNullable<
    CreateModuleDatabaseRuntimeOptions["messageChannelConstructor"]
  >;

test("a renewed client reopens the same logical database", async () => {
  const worker = new MockWorker();
  const runtime = createDatabaseRuntime(
    worker,
    recordingMessageChannelConstructor,
  );

  try {
    await runtime.client.init(INIT_OPTIONS);
    await runtime.client.exec({
      sql: "CREATE TABLE renewal_test (value TEXT NOT NULL)",
    });
    await runtime.client.exec({
      bind: ["preserved"],
      sql: "INSERT INTO renewal_test (value) VALUES (?)",
    });
    await runtime.client.close();

    expect(runtime.renewClient).toBeFunction();
    runtime.renewClient?.();
    await runtime.client.init(INIT_OPTIONS);

    await expect(
      runtime.client.exec({
        rowMode: "array",
        sql: "SELECT value FROM renewal_test",
      }),
    ).resolves.toEqual({ ok: true, rows: [["preserved"]] });

    // The second renewal retires the first transferred connection. Assert the
    // disconnect/ack exchange closes both channel endpoints in the mock too.
    await runtime.client.close();
    runtime.renewClient?.();
    await Bun.sleep(0);
    expect(RecordingMessageChannel.instances[0]?.port1.closed).toBe(true);
    expect(RecordingMessageChannel.instances[0]?.port2.closed).toBe(true);
  } finally {
    runtime.terminateNow();
  }
});

test("delete gives the next renewed client an empty database", async () => {
  const worker = new MockWorker();
  const runtime = createDatabaseRuntime(worker, mockMessageChannelConstructor);

  try {
    await runtime.client.init(INIT_OPTIONS);
    await runtime.client.exec({
      sql: "CREATE TABLE deleted_test (value TEXT NOT NULL)",
    });
    await runtime.client.delete();

    runtime.renewClient?.();
    await runtime.client.init(INIT_OPTIONS);

    await expect(
      runtime.client.exec({ sql: "SELECT value FROM deleted_test" }),
    ).rejects.toThrow("no such table");
  } finally {
    runtime.terminateNow();
  }
});
