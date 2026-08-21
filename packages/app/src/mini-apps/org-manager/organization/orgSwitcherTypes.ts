import type {
  DomainScope,
  LocalOrganizationSummary,
  SessionContext,
  SessionCreateOrganizationResult,
} from "@symcrypt/client-sdk";

/** Stable view model consumed by the organization switcher UI. */
export interface OrgSwitcherState extends CreateOrganizationDialogState {
  activeOrganizationId: string | null;
  interactionDisabled: boolean;
  organizations: readonly LocalOrganizationSummary[];
  organizationsError: string | null;
  organizationsLoading: boolean;
  selectOrganization: (organizationId: string) => void;
}

export interface CreateOrganizationDialogState {
  closeCreateOrganizationDialog: () => void;
  createOrganization: (organizationName: string) => Promise<void>;
  createOrganizationError: string | null;
  creating: boolean;
  isCreateOrganizationDialogOpen: boolean;
  openCreateOrganizationDialog: () => void;
}

/** SDK operations and lifecycle readiness consumed by the controller. */
export interface OrgSwitcherControllerInput {
  activeContainerId: string | null;
  activeOrganizationId: string | null;
  databaseReady: boolean;
  enabled: boolean;
  interactionDisabled?: boolean | undefined;
  listLocalOrganizations: () => Promise<LocalOrganizationSummary[]>;
  organizationIndexRefreshKey: string;
  operationScopeKey: string;
  provisionOrganization: (
    organizationProfileName: string,
  ) => Promise<SessionCreateOrganizationResult | null>;
  scopeKey: DomainScope;
  setSessionContext: (context: SessionContext) => void;
}

export interface LocalOrganizationsState {
  organizations: readonly LocalOrganizationSummary[];
  organizationsError: string | null;
  organizationsLoading: boolean;
  reload: () => Promise<boolean>;
  retainOrganization: (organization: LocalOrganizationSummary) => void;
}
