import { protocolOperations } from "@tearleads/validators/operation";

export {
  type ApiNetworkFailureInput,
  type AppDiagnostics,
  type DiagnosticAction,
  type DiagnosticArea,
  type DiagnosticBreadcrumb,
  isDiagnosticAction,
  isDiagnosticArea,
} from "@tearleads/diagnostics/activity";

/**
 * The only API routes a network-failure report may name: every registered
 * operation's path template. Shells pass it to their Sentry configuration.
 */
export const apiRouteTemplates: ReadonlySet<string> = new Set(
  protocolOperations.map((operation) => operation.path),
);
