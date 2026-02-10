import type { Response } from 'express';

const activeConnections = new Set<Response>();

type SseCleanupClient = {
  unsubscribe: (channel: string) => Promise<void>;
  quit: () => Promise<string>;
};

export function addConnection(res: Response): void {
  activeConnections.add(res);
}

export function removeConnection(res: Response): void {
  activeConnections.delete(res);
}

export function closeAllSSEConnections(): void {
  for (const res of activeConnections) {
    try {
      res.write(
        `event: shutdown\ndata: ${JSON.stringify({ reason: 'server_restart' })}\n\n`
      );
      res.end();
    } catch {
      // Connection may already be closed
    }
  }
  activeConnections.clear();
}

export function cleanupSseClient(
  client: SseCleanupClient | null,
  channels: string[]
): Promise<string | undefined> {
  if (!client) {
    return Promise.resolve(undefined);
  }
  return Promise.all(channels.map((ch) => client.unsubscribe(ch))).then(() =>
    client.quit()
  );
}
