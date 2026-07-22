import {
  createDatabaseWorkerClient,
  type DatabaseWorkerClient,
  type WorkerLike,
} from "./client";
import { WORKER_CONNECT_PORT_MESSAGE_TYPE } from "./types";

export interface DatabaseRuntimeMessagePort extends WorkerLike {
  close(): void;
  start(): void;
}

interface DatabaseRuntimeMessageChannel {
  readonly port1: DatabaseRuntimeMessagePort;
  readonly port2: DatabaseRuntimeMessagePort;
}

export interface DatabaseRuntimeMessageChannelConstructor {
  new (): DatabaseRuntimeMessageChannel;
}

export function availableMessageChannelConstructor(
  configured?: DatabaseRuntimeMessageChannelConstructor | null,
): DatabaseRuntimeMessageChannelConstructor | null {
  if (configured === null) {
    return null;
  }
  if (configured) {
    return configured;
  }
  return typeof MessageChannel === "undefined"
    ? null
    : (MessageChannel as unknown as DatabaseRuntimeMessageChannelConstructor);
}

export function closeMessagePort(
  port: DatabaseRuntimeMessagePort | null,
): void {
  try {
    port?.close();
  } catch {
    // Closing a transferred or already-closed port is best-effort teardown.
  }
}

function clientTransportForMessagePort(
  worker: WorkerLike,
  port: DatabaseRuntimeMessagePort,
): WorkerLike {
  return {
    addEventListener(type, listener) {
      (type === "error" ? worker : port).addEventListener(type, listener);
    },
    postMessage(message, transfer) {
      port.postMessage(message, transfer);
    },
    removeEventListener(type, listener) {
      (type === "error" ? worker : port).removeEventListener(type, listener);
    },
  };
}

export function createRenewedDatabaseClient(params: {
  readonly messageChannelConstructor: DatabaseRuntimeMessageChannelConstructor;
  readonly requestIdSequence: { current: number };
  readonly worker: WorkerLike;
}): {
  readonly client: DatabaseWorkerClient;
  readonly id: string;
  readonly port: DatabaseRuntimeMessagePort;
} {
  const channel = new params.messageChannelConstructor();
  try {
    channel.port1.start();
    params.worker.postMessage({ type: WORKER_CONNECT_PORT_MESSAGE_TYPE }, [
      channel.port2 as Transferable,
    ]);
    return {
      client: createDatabaseWorkerClient(
        clientTransportForMessagePort(params.worker, channel.port1),
        params.requestIdSequence,
      ),
      id: crypto.randomUUID(),
      port: channel.port1,
    };
  } catch (error) {
    closeMessagePort(channel.port1);
    closeMessagePort(channel.port2);
    throw error;
  }
}
