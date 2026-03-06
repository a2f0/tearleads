import { useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useDatabaseContext } from '@/db/hooks';
import {
  bindInstanceToUser,
  getInstance,
  getInstanceForUser,
  updateInstance
} from '@/db/instanceRegistry';
import { readStoredAuth, storeAuth } from '@/lib/authStorage';
import { getJwtTimeRemaining } from '@/lib/jwt';

interface InstanceAuthSnapshot {
  userId: string;
  userEmail: string;
  accessToken: string;
  refreshToken: string;
}

/**
 * Automatically keeps DB instance scope aligned with authenticated user.
 * - First login binds the current unbound instance to the user
 * - Later logins switch to the user's existing instance
 * - If current instance belongs to a different user, create and bind a new one
 */
export function AuthInstanceBinding() {
  const { user, token, isAuthenticated, isLoading: isAuthLoading, logout } =
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
  const userAuthSnapshotsRef = useRef<Map<string, InstanceAuthSnapshot>>(
    new Map()
  );

  useEffect(() => {
    if (!isAuthenticated || !user || !token) {
      return;
    }

    const stored = readStoredAuth();
    if (!stored.token || !stored.refreshToken || !stored.user) {
      return;
    }

    if (stored.user.id !== user.id) {
      return;
    }

    const tokenTimeRemaining = getJwtTimeRemaining(stored.token);
    if (tokenTimeRemaining === null || tokenTimeRemaining <= 0) {
      userAuthSnapshotsRef.current.delete(user.id);
      return;
    }

    userAuthSnapshotsRef.current.set(user.id, {
      userId: stored.user.id,
      userEmail: stored.user.email,
      accessToken: stored.token,
      refreshToken: stored.refreshToken
    });
  }, [isAuthenticated, token, user]);

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
      let alignedUserId: string | null = null;
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
        // instance, restore auth for the bound user when possible. If no
        // snapshot exists, clear auth to avoid cross-user session bleed.
        if (
          alignedUserIdRef.current === userId &&
          !isCurrentInstanceBoundToAuthenticatedUser
        ) {
          if (currentBoundUserId) {
            const storedSnapshot =
              userAuthSnapshotsRef.current.get(currentBoundUserId);
            const snapshotTimeRemaining = storedSnapshot
              ? getJwtTimeRemaining(storedSnapshot.accessToken)
              : null;
            if (
              storedSnapshot &&
              snapshotTimeRemaining !== null &&
              snapshotTimeRemaining > 0
            ) {
              storeAuth(
                storedSnapshot.accessToken,
                storedSnapshot.refreshToken,
                {
                  id: storedSnapshot.userId,
                  email: storedSnapshot.userEmail
                }
              );
              alignedUserId = storedSnapshot.userId;
              return;
            }

            if (storedSnapshot) {
              userAuthSnapshotsRef.current.delete(currentBoundUserId);
            }
          }

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
          alignedUserId = userId;
          return;
        }

        if (!currentBoundUserId) {
          await bindInstanceToUser(currentInstanceId, userId);
          await updateInstance(currentInstanceId, { name: user.email });
          await refreshInstances();
          alignedUserId = userId;
          return;
        }

        if (currentBoundUserId === userId) {
          await updateInstance(currentInstanceId, { name: user.email });
          alignedUserId = userId;
          return;
        }

        const newInstanceId = await createInstance();
        await bindInstanceToUser(newInstanceId, userId);
        await updateInstance(newInstanceId, { name: user.email });
        await refreshInstances();
        alignedUserId = userId;
        return;
      } catch (error) {
        console.error(
          'Failed to align DB instance with authenticated user:',
          error
        );
      } finally {
        if (!cancelled && alignedUserId) {
          alignedUserIdRef.current = alignedUserId;
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
