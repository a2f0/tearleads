import type {
  DomainScope,
  LocalOrganizationSummary,
  SessionContext,
  SessionCreateOrganizationResult,
} from "@tearleads/client-sdk";

/**
 * An organization whose workspace root this user can reach. The switcher only
 * offers these: selecting one makes its root the active session container, so
 * an organization reached only through Members or shared folders has nothing
 * to switch to.
 */
export interface OrganizationWorkspace extends LocalOrganizationSummary {
  rootContainerId: string;
}

/** Stable view model consumed by the organization switcher UI. */
export interface OrgSwitcherState extends CreateOrganizationDialogState {
  activeOrganizationId: string | null;
  interactionDisabled: boolean;
  organizations: readonly OrganizationWorkspace[];
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
  listLocalOrganizations: () => Promise<OrganizationWorkspace[]>;
  /** Reports an unexpected provisioning failure to diagnostics. */
  logError: (message: string | Error, cause?: unknown) => void;
  organizationIndexRefreshKey: string;
  operationScopeKey: string;
  provisionOrganization: (
    organizationProfileName: string,
  ) => Promise<SessionCreateOrganizationResult | null>;
  scopeKey: DomainScope;
  setSessionContext: (context: SessionContext) => void;
}

export interface LocalOrganizationsState {
  organizations: readonly OrganizationWorkspace[];
  organizationsError: string | null;
  organizationsLoading: boolean;
  reload: () => Promise<boolean>;
  retainOrganization: (organization: OrganizationWorkspace) => void;
}
