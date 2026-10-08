import {
  PrincipalHistoryContinuation,
  PrincipalHistoryPreparationUnavailable,
} from "../../services/principals/shared";

/** Both responses certify that the attempted mutation transaction rolled back. */
export function toPrincipalHistoryPreparationResponse(
  error: unknown,
): Response | null {
  if (error instanceof PrincipalHistoryPreparationUnavailable)
    return Response.json(
      {
        error: error.message,
        code: "principal_history_preparation_unavailable",
        committed: false,
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  if (error instanceof PrincipalHistoryContinuation)
    return Response.json(
      {
        code: error.code,
        committed: false,
        progressToken: error.progressToken,
      },
      { status: 202, headers: { "Cache-Control": "no-store" } },
    );
  return null;
}
