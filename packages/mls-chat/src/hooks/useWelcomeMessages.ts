/**
 * Hook for managing MLS welcome messages.
 * Handles pending group invitations.
 */

import type {
  MlsWelcomeMessage,
  MlsWelcomeMessagesResponse
} from '@tearleads/shared';
import { useCallback, useEffect, useState } from 'react';

import { useMlsChatApi } from '../context/index.js';
import type { MlsClient } from '../lib/index.js';
import { uploadGroupStateSnapshot } from './groupStateSync.js';
import { requestMlsRpc } from './mlsConnectRpc.js';

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
  const { apiBaseUrl, getAuthHeader } = useMlsChatApi();

  const [welcomeMessages, setWelcomeMessages] = useState<MlsWelcomeMessage[]>(
    []
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchWelcomeMessages = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const data = await requestMlsRpc<MlsWelcomeMessagesResponse>({
        context: { apiBaseUrl, getAuthHeader },
        method: 'GetWelcomeMessages',
        requestBody: {},
        errorMessage: 'Failed to fetch welcome messages'
      });
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
  }, [apiBaseUrl, getAuthHeader]);

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
            apiBaseUrl,
            getAuthHeader
          });
        } catch (uploadError) {
          console.warn(
            `Failed to upload MLS state for group ${welcome.groupId}:`,
            uploadError
          );
        }

        // Acknowledge the welcome
        await requestMlsRpc<unknown>({
          context: { apiBaseUrl, getAuthHeader },
          method: 'AcknowledgeWelcome',
          requestBody: {
            id: welcomeId,
            json: JSON.stringify({ groupId: welcome.groupId })
          },
          errorMessage: 'Failed to acknowledge welcome'
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
    [client, welcomeMessages, apiBaseUrl, getAuthHeader]
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
