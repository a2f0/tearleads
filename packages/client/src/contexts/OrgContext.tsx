import type { UserOrganization } from '@tearleads/shared';
import type { ReactNode } from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState
} from 'react';
import { isDatabaseInitialized, getDatabase } from '@/db';
import { runOrgBackfillIfNeeded } from '@/db/orgBackfill';
import {
  clearActiveOrgForUser,
  getActiveOrgForUser,
  setActiveOrgForUser
} from '@/db/orgPreference';
import { api } from '@/lib/api';
import {
  clearActiveOrganizationId as clearStoredOrgId,
  setActiveOrganizationId as setStoredOrgId
} from '@/lib/orgStorage';
import { useAuth } from './AuthContext';

interface OrgContextValue {
  organizations: UserOrganization[];
  activeOrganizationId: string | null;
  setActiveOrganizationId: (id: string) => void;
  isLoading: boolean;
}

const OrgContext = createContext<OrgContextValue | null>(null);

interface OrgProviderProps {
  children: ReactNode;
}

export function OrgProvider({ children }: OrgProviderProps) {
  const { isAuthenticated, isLoading: isAuthLoading, user } = useAuth();
  const [organizations, setOrganizations] = useState<UserOrganization[]>([]);
  const [activeOrganizationId, setActiveOrgId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const applyActiveOrg = useCallback(
    (id: string) => {
      setActiveOrgId(id);
      setStoredOrgId(id);
      if (user) {
        void setActiveOrgForUser(user.id, id);
      }
    },
    [user]
  );

  useEffect(() => {
    if (isAuthLoading) return;

    if (!isAuthenticated || !user) {
      setOrganizations([]);
      setActiveOrgId(null);
      clearStoredOrgId();
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    const userId = user.id;

    async function fetchOrgs() {
      try {
        const [response, persistedOrgId] = await Promise.all([
          api.auth.getOrganizations(),
          getActiveOrgForUser(userId)
        ]);

        if (cancelled) return;

        setOrganizations(response.organizations);

        const validPersistedOrg =
          persistedOrgId &&
          response.organizations.some((org) => org.id === persistedOrgId);

        if (validPersistedOrg) {
          applyActiveOrg(persistedOrgId);
        } else {
          applyActiveOrg(response.personalOrganizationId);
        }

        if (isDatabaseInitialized()) {
          void runOrgBackfillIfNeeded(
            getDatabase(),
            userId,
            response.personalOrganizationId
          );
        }
      } catch (error) {
        console.error('Failed to fetch organizations:', error);
        if (!cancelled) {
          setOrganizations([]);
          setActiveOrgId(null);
          clearStoredOrgId();
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    setIsLoading(true);
    void fetchOrgs();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, isAuthLoading, user, applyActiveOrg]);

  // Clear persisted org on logout
  useEffect(() => {
    if (!isAuthLoading && !isAuthenticated && user === null) {
      return;
    }

    return () => {
      if (user) {
        void clearActiveOrgForUser(user.id);
      }
    };
  }, [isAuthenticated, isAuthLoading, user]);

  const setActiveOrganizationId = applyActiveOrg;

  const value = useMemo(
    () => ({
      organizations,
      activeOrganizationId,
      setActiveOrganizationId,
      isLoading
    }),
    [organizations, activeOrganizationId, setActiveOrganizationId, isLoading]
  );

  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}

export function useOrg(): OrgContextValue {
  const context = useContext(OrgContext);
  if (!context) {
    throw new Error('useOrg must be used within an OrgProvider');
  }
  return context;
}
