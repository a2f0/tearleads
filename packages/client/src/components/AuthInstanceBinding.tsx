import { useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useDatabaseContext } from '@/db/hooks';
import {
  bindInstanceToUser,
  getInstance,
  getInstanceForUser,
  updateInstance
} from '@/db/instanceRegistry';

/**
 * Automatically keeps DB instance scope aligned with authenticated user.
 * - First login binds the current unbound instance to the user
 * - Later logins switch to the user's existing instance
 * - If current instance belongs to a different user, create and bind a new one
 */
export function AuthInstanceBinding() {
  const { user, isAuthenticated, isLoading: isAuthLoading, logout } =
    useAuth();
  const {
    isLoading: isDatabaseLoading,
    currentInstanceId,
    createInstance,
    refreshInstances,
    switchInstance
  } = useDatabaseContext();
  const isBindingRef = useRef(false);
  const alignedUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated || !user) {
      alignedUserIdRef.current = null;
      return;
    }

    if (isBindingRef.current) {
      return;
    }
    if (isAuthLoading || isDatabaseLoading) {
      return;
    }
    if (!currentInstanceId) {
      return;
    }

    let cancelled = false;
    isBindingRef.current = true;

    void (async () => {
      let alignedSuccessfully = false;
      try {
        const userId = user.id;
        const [boundInstance, currentInstance] = await Promise.all([
          getInstanceForUser(userId),
          getInstance(currentInstanceId)
        ]);
        if (cancelled || !currentInstance) {
          return;
        }

        const currentBoundUserId = currentInstance.boundUserId ?? null;
        const isCurrentInstanceBoundToAuthenticatedUser =
          currentBoundUserId === userId;

        // If we already aligned this user and they move to a different/unbound
        // instance, clear auth so each instance has its own sync session.
        if (
          alignedUserIdRef.current === userId &&
          !isCurrentInstanceBoundToAuthenticatedUser
        ) {
          await logout();
          return;
        }

        if (
          alignedUserIdRef.current === userId &&
          isCurrentInstanceBoundToAuthenticatedUser
        ) {
          return;
        }

        if (boundInstance) {
          if (boundInstance.id !== currentInstanceId) {
            await switchInstance(boundInstance.id);
          }
          await updateInstance(boundInstance.id, { name: user.email });
          alignedSuccessfully = true;
          return;
        }

        if (!currentBoundUserId) {
          await bindInstanceToUser(currentInstanceId, userId);
          await updateInstance(currentInstanceId, { name: user.email });
          await refreshInstances();
          alignedSuccessfully = true;
          return;
        }

        if (currentBoundUserId === userId) {
          await updateInstance(currentInstanceId, { name: user.email });
          alignedSuccessfully = true;
          return;
        }

        const newInstanceId = await createInstance();
        await bindInstanceToUser(newInstanceId, userId);
        await updateInstance(newInstanceId, { name: user.email });
        await refreshInstances();
        alignedSuccessfully = true;
        return;
      } catch (error) {
        console.error(
          'Failed to align DB instance with authenticated user:',
          error
        );
      } finally {
        if (!cancelled && alignedSuccessfully) {
          alignedUserIdRef.current = user.id;
        }
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
    isAuthLoading,
    isDatabaseLoading,
    refreshInstances,
    switchInstance,
    logout,
    isAuthenticated,
    user
  ]);

  return null;
}
