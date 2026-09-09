// Only this vocabulary may cross the diagnostics boundary. Never add entity
// IDs, names, document kinds, route segments, or arbitrary text to this contract.
export const DIAGNOSTIC_AREAS = [
  "app",
  "backup-restore",
  "contacts",
  "explorer",
  "identity-manager",
  "notes",
  "org-manager",
  "root",
  "system-monitor",
] as const;
export const DIAGNOSTIC_ACTIONS = [
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
}

export function isDiagnosticArea(value: unknown): value is DiagnosticArea {
  return DIAGNOSTIC_AREAS.some((area) => area === value);
}
export function isDiagnosticAction(value: unknown): value is DiagnosticAction {
  return DIAGNOSTIC_ACTIONS.some((action) => action === value);
}
