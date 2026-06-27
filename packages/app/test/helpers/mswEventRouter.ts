export interface MswSocketClient {
  addEventListener?: (
    type: "close" | "message",
    listener: (event: { data?: unknown }) => void,
  ) => void;
  send: (data: string) => void;
}

type MswServerEventPredicate = (event: Record<string, unknown>) => boolean;

interface MswEventDropRule {
  droppedCount: number;
  predicate: MswServerEventPredicate;
  remainingCount: number;
}

const eventDropRules: MswEventDropRule[] = [];

/**
 * Test-only fault injection for the MSW websocket router.
 *
 * The production sync contract must tolerate a missed websocket invalidation:
 * websocket events are hints to pull, not the durable source of document data.
 * Regression tests use this hook to drop one matching server event after the
 * writer has successfully committed over HTTP, then assert an explicit refresh
 * or open path can still recover the committed remote state.
 */
export function dropNextMswServerEventWhere(
  predicate: MswServerEventPredicate,
): () => number {
  const rule: MswEventDropRule = {
    droppedCount: 0,
    predicate,
    remainingCount: 1,
  };
  eventDropRules.push(rule);
  return () => rule.droppedCount;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJsonRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readContainerIdArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const containerIds: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || entry.length === 0) {
      return null;
    }
    containerIds.push(entry);
  }
  return containerIds;
}

function readStringField(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readEventContainerIds(event: Record<string, unknown>): string[] {
  const containerIds = new Set<string>();
  const scopedContainerIds = Reflect.get(event, "containerIds");
  if (Array.isArray(scopedContainerIds)) {
    for (const containerId of scopedContainerIds) {
      if (typeof containerId === "string" && containerId.length > 0) {
        containerIds.add(containerId);
      }
    }
  }
  for (const field of ["containerId", "parentId", "previousParentId"]) {
    const containerId = readStringField(Reflect.get(event, field));
    if (containerId) {
      containerIds.add(containerId);
    }
  }
  return [...containerIds];
}

function shouldDropServerEvent(event: Record<string, unknown>): boolean {
  // Evaluate before access_changed/document routing so a test can suppress the
  // exact server event it is modeling as missed by the websocket transport.
  for (const [index, rule] of eventDropRules.entries()) {
    if (!rule.predicate(event)) {
      continue;
    }
    rule.droppedCount += 1;
    rule.remainingCount -= 1;
    if (rule.remainingCount <= 0) {
      eventDropRules.splice(index, 1);
    }
    return true;
  }

  return false;
}

export function createMswEventRouter(eventsSocket: {
  broadcast: (data: string) => void;
}) {
  const socketInterestByClient = new Map<MswSocketClient, Set<string>>();

  const sendSocketEvent = (
    client: MswSocketClient,
    event: Record<string, unknown>,
  ): void => {
    try {
      client.send(JSON.stringify(event));
    } catch {
      socketInterestByClient.delete(client);
    }
  };

  const handleSocketInterestMessage = (
    client: MswSocketClient,
    rawMessage: string,
  ): void => {
    const message = readJsonRecord(rawMessage);
    if (!message) {
      return;
    }

    const containerIds = readContainerIdArray(
      Reflect.get(message, "containerIds"),
    );
    if (!containerIds) {
      return;
    }

    const current = socketInterestByClient.get(client) ?? new Set<string>();
    switch (Reflect.get(message, "type")) {
      case "known_containers":
        socketInterestByClient.set(client, new Set(containerIds));
        break;
      case "known_containers.add":
        for (const containerId of containerIds) {
          current.add(containerId);
        }
        socketInterestByClient.set(client, current);
        break;
      case "known_containers.remove":
        for (const containerId of containerIds) {
          current.delete(containerId);
        }
        socketInterestByClient.set(client, current);
        break;
    }
  };

  const handleAccessChangedEvent = (event: Record<string, unknown>): void => {
    const containerId = readStringField(Reflect.get(event, "containerId"));
    if (!containerId) {
      return;
    }

    for (const [client, interest] of socketInterestByClient) {
      if (!interest.has(containerId)) {
        continue;
      }
      interest.delete(containerId);
      sendSocketEvent(client, { containerId, type: "resync_required" });
    }
  };

  return {
    clear: () => {
      eventDropRules.length = 0;
      socketInterestByClient.clear();
    },
    handleConnection: (client: MswSocketClient) => {
      socketInterestByClient.set(client, new Set());
      client.addEventListener?.("message", (event) => {
        handleSocketInterestMessage(client, String(event.data ?? ""));
      });
      client.addEventListener?.("close", () => {
        socketInterestByClient.delete(client);
      });

      client.send(JSON.stringify({ type: "interest_state", containerIds: [] }));
    },
    publish: (event: Record<string, unknown>) => {
      if (shouldDropServerEvent(event)) {
        return;
      }

      if (Reflect.get(event, "type") === "access_changed") {
        handleAccessChangedEvent(event);
        return;
      }

      const containerIds = readEventContainerIds(event);
      if (containerIds.length === 0) {
        eventsSocket.broadcast(JSON.stringify(event));
        return;
      }

      for (const [client, interest] of socketInterestByClient) {
        if (containerIds.some((containerId) => interest.has(containerId))) {
          sendSocketEvent(client, event);
        }
      }
    },
  };
}
