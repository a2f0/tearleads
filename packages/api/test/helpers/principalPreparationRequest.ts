import { createOrganizationGroupOperation } from "@tearleads/validators/operation";
import { routeApp } from "../../src/routeApp";

/** Test transports obey the same explicit rollback continuation as ApiClient. */
export async function requestAfterPrincipalPreparation(
  path: string,
  init: RequestInit,
) {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const response = await routeApp.request(path, init);
    if (response.status !== 202) return response;
    const progress = createOrganizationGroupOperation.responses[202].parse(
      await response.json(),
    );
    if (progress.committed !== false)
      throw new Error("Preparation did not prove rollback");
  }
  throw new Error("Principal preparation did not finish in 32 requests");
}
