/**
 * Hook for managing MLS welcome messages.
 * Handles pending group invitations.
 */

import type { MlsWelcomeMessage } from '@tearleads/shared';
import { useCallback, useEffect, useState } from 'react';

import { useMlsRoutes } from '../context/index.js';
import type { MlsClient } from '../lib/index.js';
import { uploadGroupStateSnapshot } from './groupStateSync.js';

interface UseWelcomeMessagesResult {
  welcomeMessages: MlsWelcomeMessage[];
  isLoading: boolean;
  error: Error | null;
  processWelcome: (welcomeId: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useWelcomeMessages(
  client: MlsClient | null
): UseWelcomeMessagesResult {
  const mlsRoutes = useMlsRoutes();

  const [welcomeMessages, setWelcomeMessages] = useState<MlsWelcomeMessage[]>(
    []
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchWelcomeMessages = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const data = await mlsRoutes.getWelcomeMessages();
      setWelcomeMessages(data.welcomes);
    } catch (err) {
      setError(
        err instanceof Error
          ? err
          : new Error('Failed to fetch welcome messages')
      );
    } finally {
      setIsLoading(false);
    }
  }, [mlsRoutes]);

  const processWelcome = useCallback(
    async (welcomeId: string) => {
      if (!client) {
        throw new Error('MLS client not initialized');
      }

      const welcome = welcomeMessages.find((w) => w.id === welcomeId);
      if (!welcome) {
        throw new Error('Welcome message not found');
      }

      try {
        // Decode and process the welcome
        const welcomeBytes = Uint8Array.from(atob(welcome.welcome), (c) =>
          c.charCodeAt(0)
        );

        // Join the group
        await client.joinGroup(
          welcome.groupId,
          welcomeBytes,
          welcome.keyPackageRef
        );
        try {
          await uploadGroupStateSnapshot({
            groupId: welcome.groupId,
            client,
            mlsRoutes
          });
        } catch (uploadError) {
          console.warn(
            `Failed to upload MLS state for group ${welcome.groupId}:`,
            uploadError
          );
        }

        // Acknowledge the welcome
        await mlsRoutes.acknowledgeWelcome(welcomeId, {
          groupId: welcome.groupId
        });

        // Remove from local state
        setWelcomeMessages((prev) => prev.filter((w) => w.id !== welcomeId));
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to process welcome';
        setError(new Error(message));
        throw err;
      }
    },
    [client, welcomeMessages, mlsRoutes]
  );

  useEffect(() => {
    if (client) {
      fetchWelcomeMessages();
    }
  }, [client, fetchWelcomeMessages]);

  useEffect(() => {
    const handlerKey = '__mlsWelcomeRefreshHandler';
    const existingHandlers = Reflect.get(globalThis, handlerKey);
    const refreshHandlers =
      existingHandlers instanceof Set
        ? existingHandlers
        : new Set<() => Promise<void>>();

    if (!(existingHandlers instanceof Set)) {
      Reflect.set(globalThis, handlerKey, refreshHandlers);
    }

    const refreshHandler = () => fetchWelcomeMessages();
    refreshHandlers.add(refreshHandler);

    return () => {
      refreshHandlers.delete(refreshHandler);
      if (refreshHandlers.size === 0) {
        Reflect.deleteProperty(globalThis, handlerKey);
      }
    };
  }, [fetchWelcomeMessages]);

  return {
    welcomeMessages,
    isLoading,
    error,
    processWelcome,
    refresh: fetchWelcomeMessages
  };
}
