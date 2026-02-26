import { useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useDatabaseContext } from '@/db/hooks';
import {
  bindInstanceToUser,
  getInstance,
  getInstanceForUser
} from '@/db/instanceRegistry';

/**
 * Automatically keeps DB instance scope aligned with authenticated user.
 * - First login binds the current unbound instance to the user
 * - Later logins switch to the user's existing instance
 * - If current instance belongs to a different user, create and bind a new one
 */
export function AuthInstanceBinding() {
  const { user, isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const {
    isLoading: isDatabaseLoading,
    currentInstanceId,
    createInstance,
    refreshInstances,
    switchInstance
  } = useDatabaseContext();
  const isBindingRef = useRef(false);

  useEffect(() => {
    if (isBindingRef.current) {
      return;
    }
    if (isAuthLoading || isDatabaseLoading) {
      return;
    }
    if (!isAuthenticated || !user || !currentInstanceId) {
      return;
    }

    let cancelled = false;
    isBindingRef.current = true;

    void (async () => {
      try {
        const userId = user.id;
        const [boundInstance, currentInstance] = await Promise.all([
          getInstanceForUser(userId),
          getInstance(currentInstanceId)
        ]);
        if (cancelled || !currentInstance) {
          return;
        }

        if (boundInstance) {
          if (boundInstance.id !== currentInstanceId) {
            await switchInstance(boundInstance.id);
          }
          return;
        }

        const currentBoundUserId = currentInstance?.boundUserId ?? null;
        if (!currentBoundUserId) {
          await bindInstanceToUser(currentInstanceId, userId);
          await refreshInstances();
          return;
        }

        if (currentBoundUserId === userId) {
          return;
        }

        const newInstanceId = await createInstance();
        await bindInstanceToUser(newInstanceId, userId);
        await refreshInstances();
      } catch (error) {
        console.error(
          'Failed to align DB instance with authenticated user:',
          error
        );
      } finally {
        isBindingRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
      isBindingRef.current = false;
    };
  }, [
    createInstance,
    currentInstanceId,
    isAuthenticated,
    isAuthLoading,
    isDatabaseLoading,
    refreshInstances,
    switchInstance,
    user
  ]);

  return null;
}
