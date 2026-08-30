import { base64ToBytes, bytesToBase64 } from "@symcrypt/encoding";
import { isPlainObject } from "@symcrypt/validators/isPlainObject";
import {
  type CreateOrganizationRequest,
  isCreateOrganizationRequest,
} from "@symcrypt/validators/request";
import { sqlOrganizationProvisioningAttemptPersistence } from "../../data/persistence/organizations/organizationProvisioningAttemptPersistence";
import type { ExecSql, ExecSqlClientLike } from "../../data/sqlite/sqlSchema";
import { createExecSql } from "../../data/sqlite/sqlSchema";
import type { OrganizationProvisioningArtifacts } from "../registration/registerIdentity";

const BYTE_MARKER = "__symcryptProvisioningBytes";

interface DurableOrganizationProvisioningAttempt {
  readonly artifacts: OrganizationProvisioningArtifacts;
  readonly request: CreateOrganizationRequest;
  readonly rootContainerId: string;
}

function buildCreateOrganizationRequest(input: {
  artifacts: OrganizationProvisioningArtifacts;
  finalizeReplacement?: boolean | undefined;
  replacesOrganizationId?: string | undefined;
  rootContainerId: string;
  userId: string;
}): CreateOrganizationRequest {
  const { artifacts } = input;
  return {
    userId: input.userId,
    organizationId: artifacts.organizationId,
    rootContainerId: input.rootContainerId,
    initialAdminGroup: artifacts.initialAdminGroup,
    initialMemberGroup: artifacts.initialMemberGroup,
    initialOrganizationPolicy: artifacts.initialOrganizationPolicy,
    initialRootContainer: artifacts.initialRootContainer,
    initialRootMetadataDocument: artifacts.rootMetadataDocumentRequest,
    initialRosterProfileContainer:
      artifacts.rosterProfileBootstrap.containerRequest,
    initialRosterProfileDocument:
      artifacts.rosterProfileBootstrap.profileDocumentRequest,
    initialOrganizationMetadataContainer:
      artifacts.organizationMetadataBootstrap.containerRequest,
    initialOrganizationProfileDocument:
      artifacts.organizationMetadataBootstrap
        .organizationProfileDocumentRequest,
    initialSystemContainers: artifacts.systemContainerBootstraps.map(
      (systemContainer) => systemContainer.containerRequest,
    ),
    ...(input.finalizeReplacement ? { finalizeReplacement: true } : {}),
    ...(input.replacesOrganizationId
      ? { replacesOrganizationId: input.replacesOrganizationId }
      : {}),
  };
}

export async function loadOrganizationReplacementFinalizationRequest(input: {
  execSql: ExecSql;
  replacedOrganizationId: string;
  userId: string;
}): Promise<CreateOrganizationRequest> {
  const stored = await sqlOrganizationProvisioningAttemptPersistence.load(
    input.execSql,
    input.replacedOrganizationId,
  );
  if (!stored) {
    throw new Error("Organization replacement attempt is unavailable");
  }
  if (stored.userId !== input.userId) {
    throw new Error(
      "Stored organization provisioning attempt belongs to another user",
    );
  }
  const artifacts = deserializeArtifacts(stored.serializedArtifacts);
  const request = buildCreateOrganizationRequest({
    artifacts,
    finalizeReplacement: true,
    replacesOrganizationId: input.replacedOrganizationId,
    rootContainerId: stored.rootContainerId,
    userId: stored.userId,
  });
  if (
    artifacts.organizationId !== stored.organizationId ||
    request.organizationId !== stored.organizationId ||
    request.rootContainerId !== stored.rootContainerId ||
    !isCreateOrganizationRequest(request)
  ) {
    throw new Error("Stored organization provisioning attempt is inconsistent");
  }
  return request;
}

function serializeArtifacts(artifacts: OrganizationProvisioningArtifacts) {
  return JSON.stringify(artifacts, (_key, value: unknown) => {
    if (value instanceof Uint8Array) {
      return { [BYTE_MARKER]: bytesToBase64(value) };
    }
    return value;
  });
}

function hasRecord(value: Record<string, unknown>, key: string): boolean {
  return isPlainObject(Reflect.get(value, key));
}

function hasBytes(value: Record<string, unknown>, key: string): boolean {
  return Reflect.get(value, key) instanceof Uint8Array;
}

function isMaterializedDocument(value: unknown): boolean {
  return (
    isPlainObject(value) &&
    hasBytes(value, "contentKey") &&
    hasRecord(value, "plan")
  );
}

function isMaterializedContainer(value: unknown): boolean {
  return (
    isPlainObject(value) &&
    hasBytes(value, "containerKey") &&
    hasRecord(value, "plan")
  );
}

function hasContainerBootstrapCore(value: Record<string, unknown>): boolean {
  return (
    typeof Reflect.get(value, "containerId") === "string" &&
    isMaterializedDocument(Reflect.get(value, "containerMetadataDocument")) &&
    hasBytes(value, "containerMetadataInitialUpdate") &&
    isMaterializedContainer(Reflect.get(value, "containerPlan")) &&
    hasRecord(value, "containerRequest") &&
    Reflect.get(value, "systemSlot") !== undefined
  );
}

function isOrganizationProvisioningArtifacts(
  value: unknown,
): value is OrganizationProvisioningArtifacts {
  if (!isPlainObject(value)) return false;
  const bootstrap = Reflect.get(value, "bootstrap");
  const roster = Reflect.get(value, "rosterProfileBootstrap");
  const metadata = Reflect.get(value, "organizationMetadataBootstrap");
  const systemContainers = Reflect.get(value, "systemContainerBootstraps");
  return (
    typeof Reflect.get(value, "organizationId") === "string" &&
    isPlainObject(bootstrap) &&
    hasBytes(bootstrap, "initialUpdate") &&
    typeof Reflect.get(bootstrap, "metadataDocumentId") === "string" &&
    hasRecord(value, "initialAdminGroup") &&
    hasRecord(value, "initialMemberGroup") &&
    hasRecord(value, "initialOrganizationPolicy") &&
    hasRecord(value, "initialRootContainer") &&
    isMaterializedContainer(Reflect.get(value, "rootContainer")) &&
    isMaterializedDocument(Reflect.get(value, "rootMetadataDocument")) &&
    hasRecord(value, "rootMetadataDocumentRequest") &&
    isPlainObject(roster) &&
    hasContainerBootstrapCore(roster) &&
    isMaterializedDocument(Reflect.get(roster, "profileDocument")) &&
    hasBytes(roster, "profileDocumentInitialUpdate") &&
    hasRecord(roster, "profileDocumentRequest") &&
    isPlainObject(metadata) &&
    hasContainerBootstrapCore(metadata) &&
    isMaterializedDocument(
      Reflect.get(metadata, "organizationProfileDocument"),
    ) &&
    hasRecord(metadata, "organizationProfileDocumentRequest") &&
    typeof Reflect.get(metadata, "organizationProfileSnapshot") === "string" &&
    Array.isArray(systemContainers) &&
    systemContainers.every(
      (container) =>
        isPlainObject(container) && hasContainerBootstrapCore(container),
    )
  );
}

function deserializeArtifacts(
  value: string,
): OrganizationProvisioningArtifacts {
  const parsed: unknown = JSON.parse(value, (_key, candidate: unknown) => {
    if (
      typeof candidate === "object" &&
      candidate !== null &&
      Object.keys(candidate).length === 1 &&
      BYTE_MARKER in candidate
    ) {
      const encoded = Reflect.get(candidate, BYTE_MARKER);
      if (typeof encoded === "string") {
        return base64ToBytes(encoded);
      }
    }
    return candidate;
  });
  if (!isOrganizationProvisioningArtifacts(parsed)) {
    throw new Error("Stored organization provisioning attempt is invalid");
  }
  return parsed;
}

export async function makeOrganizationProvisioningAttemptDurable(input: {
  artifacts: OrganizationProvisioningArtifacts;
  canStartDurableMutation?: (() => boolean) | undefined;
  dbClient: ExecSqlClientLike;
  replacesOrganizationId?: string | undefined;
  rootContainerId: string;
  userId: string;
}): Promise<DurableOrganizationProvisioningAttempt | null> {
  if (!input.replacesOrganizationId) {
    return {
      artifacts: input.artifacts,
      request: buildCreateOrganizationRequest(input),
      rootContainerId: input.rootContainerId,
    };
  }
  const stored = await sqlOrganizationProvisioningAttemptPersistence.loadOrSave(
    createExecSql(input.dbClient),
    {
      replacedOrganizationId: input.replacesOrganizationId,
      userId: input.userId,
      organizationId: input.artifacts.organizationId,
      rootContainerId: input.rootContainerId,
      serializedArtifacts: serializeArtifacts(input.artifacts),
    },
    input.canStartDurableMutation,
  );
  if (!stored) return null;
  if (stored.userId !== input.userId) {
    throw new Error(
      "Stored organization provisioning attempt belongs to another user",
    );
  }
  const artifacts = deserializeArtifacts(stored.serializedArtifacts);
  const request = buildCreateOrganizationRequest({
    artifacts,
    replacesOrganizationId: input.replacesOrganizationId,
    rootContainerId: stored.rootContainerId,
    userId: stored.userId,
  });
  if (
    artifacts.organizationId !== stored.organizationId ||
    request.organizationId !== stored.organizationId ||
    request.rootContainerId !== stored.rootContainerId ||
    !isCreateOrganizationRequest(request)
  ) {
    throw new Error("Stored organization provisioning attempt is inconsistent");
  }
  return { artifacts, request, rootContainerId: stored.rootContainerId };
}

export async function removeOrganizationProvisioningAttempt(input: {
  canCommit?: (() => boolean) | undefined;
  execSql: ExecSql;
  replacedOrganizationId: string;
  userId: string;
}): Promise<boolean> {
  return sqlOrganizationProvisioningAttemptPersistence.remove(
    input.execSql,
    input,
    input.canCommit,
  );
}
