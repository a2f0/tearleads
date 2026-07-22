import {
  createDatabaseWorkerClient,
  type DatabaseWorkerClient,
  type WorkerLike,
} from "./client";
import { WORKER_CONNECT_PORT_MESSAGE_TYPE } from "./types";

export type DatabaseRuntimeMessagePort = MessagePort;

export interface DatabaseRuntimeMessageChannelConstructor {
  new (): MessageChannel;
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
  return typeof MessageChannel === "undefined" ? null : MessageChannel;
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
      if (type === "error") {
        worker.addEventListener(type, listener);
      } else {
        port.addEventListener(type, listener);
      }
    },
    postMessage(message, transfer) {
      if (transfer) {
        port.postMessage(message, transfer);
      } else {
        port.postMessage(message);
      }
    },
    removeEventListener(type, listener) {
      if (type === "error") {
        worker.removeEventListener(type, listener);
      } else {
        port.removeEventListener(type, listener);
      }
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
      channel.port2,
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
