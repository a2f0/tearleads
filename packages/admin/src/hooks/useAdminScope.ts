import { api } from '@tearleads/api-client';
import type { AdminAccessContextResponse } from '@tearleads/shared';
import { useCallback, useEffect, useState } from 'react';

type UseAdminScopeResult = {
  context: AdminAccessContextResponse | null;
  selectedOrganizationId: string | null;
  loading: boolean;
  error: string | null;
  setSelectedOrganizationId: (organizationId: string | null) => void;
};

function getDefaultOrganizationId(
  context: AdminAccessContextResponse
): string | null {
  if (context.isRootAdmin) {
    return null;
  }
  return context.defaultOrganizationId ?? context.organizations[0]?.id ?? null;
}

export function useAdminScope(): UseAdminScopeResult {
  const [context, setContext] = useState<AdminAccessContextResponse | null>(
    null
  );
  const [selectedOrganizationId, setSelectedOrganizationIdState] = useState<
    string | null
  >(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadContext = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await api.admin.getContext();
        if (cancelled) return;
        setContext(response);
        setSelectedOrganizationIdState(getDefaultOrganizationId(response));
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error ? err.message : 'Failed to load admin scope'
        );
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadContext();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!context) return;
    if (context.isRootAdmin) return;

    if (
      selectedOrganizationId &&
      context.organizations.some((org) => org.id === selectedOrganizationId)
    ) {
      return;
    }

    setSelectedOrganizationIdState(getDefaultOrganizationId(context));
  }, [context, selectedOrganizationId]);

  const setSelectedOrganizationId = useCallback(
    (organizationId: string | null) => {
      if (!context) return;

      if (organizationId === null) {
        if (context.isRootAdmin) {
          setSelectedOrganizationIdState(null);
          return;
        }
        setSelectedOrganizationIdState(getDefaultOrganizationId(context));
        return;
      }

      if (!context.organizations.some((org) => org.id === organizationId)) {
        return;
      }

      setSelectedOrganizationIdState(organizationId);
    },
    [context]
  );

  return {
    context,
    selectedOrganizationId,
    loading,
    error,
    setSelectedOrganizationId
  };
}
