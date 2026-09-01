import type {
  DomainScope,
  LocalOrganizationSummary,
} from "@tearleads/client-sdk";
import { useEffect, useState } from "react";

export const EMPTY_ORGANIZATION_NAMES: ReadonlyMap<string, string> = new Map();

interface OrganizationNamesState {
  readonly namesById: ReadonlyMap<string, string>;
  readonly scope: DomainScope | null;
}

function buildOrganizationNames(
  organizations: ReadonlyArray<LocalOrganizationSummary>,
): ReadonlyMap<string, string> {
  const namesById = new Map<string, string>();
  for (const organization of organizations) {
    if (organization.name) {
      namesById.set(organization.organizationId, organization.name);
    }
  }
  return namesById;
}

export function useBlobOrganizationNames(params: {
  listLocalOrganizations: () => Promise<
    ReadonlyArray<LocalOrganizationSummary>
  >;
  ready: boolean;
  scope: DomainScope;
}): ReadonlyMap<string, string> {
  const [state, setState] = useState<OrganizationNamesState>({
    namesById: EMPTY_ORGANIZATION_NAMES,
    scope: null,
  });

  useEffect(() => {
    if (!params.ready) {
      return;
    }
    let active = true;
    void params.listLocalOrganizations().then(
      (organizations) => {
        if (active) {
          setState({
            namesById: buildOrganizationNames(organizations),
            scope: params.scope,
          });
        }
      },
      () => {
        if (active) {
          setState({
            namesById: EMPTY_ORGANIZATION_NAMES,
            scope: params.scope,
          });
        }
      },
    );
    return () => {
      active = false;
    };
  }, [params.listLocalOrganizations, params.ready, params.scope]);

  return params.ready && state.scope === params.scope
    ? state.namesById
    : EMPTY_ORGANIZATION_NAMES;
}
