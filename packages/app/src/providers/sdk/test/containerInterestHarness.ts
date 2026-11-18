import { expect, mock } from "bun:test";
import { createDomainScope, type Tearleads } from "@tearleads/client-sdk";
import type { startContainerInterestDeclaration } from "../containerInterest";

export function createFakeStore(initialIds: string[]) {
  let ids = initialIds;
  let ready = true;
  const listeners = new Set<() => void>();
  return {
    setNodes(next: string[]) {
      ids = next;
      for (const listener of listeners) {
        listener();
      }
    },
    setReady(next: boolean) {
      ready = next;
      for (const listener of listeners) {
        listener();
      }
    },
    store: {
      getSnapshot: () => ({ nodes: ids.map((id) => ({ id })), ready }),
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  };
}

export function acknowledgeInitialDeclaration(
  handle: ReturnType<typeof startContainerInterestDeclaration>,
  sent: string[],
): void {
  const declaration = JSON.parse(sent.at(-1) ?? "null") as {
    declarationId?: unknown;
    containerIds: string[];
  };
  expect(typeof declaration.declarationId).toBe("string");
  expect(
    handle.acknowledge(
      String(declaration.declarationId),
      declaration.containerIds,
    ),
  ).toBe(true);
}

export function tearleadsWithStore(openTree: () => unknown): Tearleads {
  return {
    domainScope: createDomainScope(),
    events: { setConnected: () => {} },
    deviceFirst: {
      open: () => ({ containerStore: openTree() }),
    },
  } as unknown as Tearleads;
}

export function fakeSocket(readyState: number) {
  const sent: string[] = [];
  const close = mock(() => {});
  return {
    sent,
    close,
    ws: {
      close,
      readyState,
      send: (message: string) => {
        sent.push(message);
      },
    } as unknown as WebSocket,
  };
}
