import type { ApiNetworkFailureInput } from "./apiNetworkFailure";

export type { ApiNetworkFailureInput };

// Only this vocabulary may cross the diagnostics boundary. Never add entity
// IDs, names, document kinds, route segments, or arbitrary text to this contract.
const DIAGNOSTIC_AREAS = [
  "app",
  "backup-restore",
  "contacts",
  "display-properties",
  "explorer",
  "identity-manager",
  "notes",
  "org-manager",
  "organizations",
  "root",
  "system-monitor",
] as const;
const DIAGNOSTIC_ACTIONS = [
  "open",
  "navigate",
  "retry",
  "error",
  "create",
  "edit",
  "move",
  "move-to-trash",
  "delete",
  "empty-trash",
  "import",
  "export",
  "share",
  "root-view",
  "trash-view",
  "folder-view",
  "document-view",
] as const;

export type DiagnosticArea = (typeof DIAGNOSTIC_AREAS)[number];
export type DiagnosticAction = (typeof DIAGNOSTIC_ACTIONS)[number];
export interface DiagnosticBreadcrumb {
  area: DiagnosticArea;
  action: DiagnosticAction;
}
export interface DiagnosticErrorContext {
  area: DiagnosticArea;
  source: "boundary" | "log" | "unhandled-error" | "unhandled-rejection";
}
export interface AppDiagnostics {
  addBreadcrumb: (breadcrumb: DiagnosticBreadcrumb) => void;
  captureError: (error: unknown, context: DiagnosticErrorContext) => void;
  clearBreadcrumbs?: () => void;
  /** Tag later reports with the API build the client last heard from. */
  setApiVersion?: (version: number) => void;
  /**
   * An API request that got no response. Only the reviewed coarse fields leave
   * the device, rate limited; see docs/developer/api-network-failures.md.
   */
  reportApiNetworkFailure?: (failure: ApiNetworkFailureInput) => void;
  /** The operation path templates network reports may name; others: `other`. */
  setApiRouteTemplates?: (routes: ReadonlySet<string>) => void;
}

export function isDiagnosticArea(value: unknown): value is DiagnosticArea {
  return DIAGNOSTIC_AREAS.some((area) => area === value);
}
export function isDiagnosticAction(value: unknown): value is DiagnosticAction {
  return DIAGNOSTIC_ACTIONS.some((action) => action === value);
}
