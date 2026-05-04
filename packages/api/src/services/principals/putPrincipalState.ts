import type { PrincipalStateResponse } from "@tearleads/validators/response";
import {
  type PutPrincipalStateInput,
  runPutPrincipalStateWorkflow,
} from "../../workflows/principals/putPrincipalState";
import type { ApiServiceRuntime } from "../runtime";

export async function putPrincipalState(
  runtime: ApiServiceRuntime,
  input: PutPrincipalStateInput,
): Promise<PrincipalStateResponse> {
  return runPutPrincipalStateWorkflow(runtime.db, input);
}
