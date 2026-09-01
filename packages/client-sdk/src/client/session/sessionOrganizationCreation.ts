import type { ApiClient } from "@symcrypt/api-client";
import type { DocumentProjectorRegistryInput } from "../../data/documents/documentKinds";
import { createOrganization as createOrganizationWorkflow } from "../../workflows/organizations/createOrganization";
import type { ProvisionedSystemContainerSpec } from "../../workflows/registration";
import type { Database } from "../database";
import type { Identity } from "../identity";
import type {
  CreateOrganizationOptions,
  SessionCreateOrganizationResult,
} from "./sessionTypes";

interface SessionOrganizationCreationDependencies {
  readonly api: ApiClient;
  readonly database: Database;
  readonly documentProjectors?: DocumentProjectorRegistryInput | undefined;
  readonly identity: Identity;
  readonly log: (message: string) => void;
  readonly logError: (message: string | Error, cause?: unknown) => void;
  readonly provisionedSystemContainers?:
    | ReadonlyArray<ProvisionedSystemContainerSpec>
    | undefined;
}

export async function createSessionOrganization(
  dependencies: SessionOrganizationCreationDependencies,
  input: {
    readonly nativeSubscriptionRestore?: boolean | undefined;
    readonly options?: CreateOrganizationOptions | undefined;
    readonly replacesOrganizationId?: string | undefined;
    readonly userId: string | null;
  },
): Promise<SessionCreateOrganizationResult | null> {
  if (!input.userId) {
    dependencies.log("Create organization skipped: user id is unavailable");
    return null;
  }

  const identitySnapshot = dependencies.identity.snapshot;
  const { encapsulationKeyPair, signingKeyPair } = identitySnapshot;
  if (!signingKeyPair || !encapsulationKeyPair) {
    dependencies.log(
      "Create organization skipped: identity keys are unavailable",
    );
    return null;
  }

  const dbClient = dependencies.database.client;
  if (!dbClient) {
    dependencies.log(
      "Create organization skipped: database client is unavailable",
    );
    return null;
  }

  let response: Awaited<ReturnType<typeof createOrganizationWorkflow>>;
  try {
    response = await createOrganizationWorkflow({
      apiClient: dependencies.api,
      dbClient,
      documentProjectors: dependencies.documentProjectors,
      encapsulationKeyPair,
      isIdentityCurrent: () =>
        dependencies.identity.snapshot === identitySnapshot,
      log: dependencies.log,
      logError: dependencies.logError,
      nativeSubscriptionRestore: input.nativeSubscriptionRestore,
      organizationProfileName: input.options?.organizationProfileName,
      provisionedSystemContainers: dependencies.provisionedSystemContainers,
      replacesOrganizationId: input.replacesOrganizationId,
      rosterProfileNickname: input.options?.rosterProfileNickname,
      signingKeyPair,
      userId: input.userId,
    });
  } catch (error: unknown) {
    dependencies.logError("Organization creation failed", error);
    throw error;
  }

  if (dependencies.identity.snapshot !== identitySnapshot) return null;
  if (!response) {
    dependencies.log("Organization creation failed");
    return null;
  }
  // Creating an organization does not switch the active organization.
  return {
    containerId: response.rootContainerId,
    organizationId: response.organizationId,
  };
}
