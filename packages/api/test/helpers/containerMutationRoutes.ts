import { test as bunTest, expect } from "bun:test";
import type { VerifiedContainerKekState } from "@tearleads/crypto";
import type { TestUser } from "@tearleads/test-utils";
import type {
  AccessManifestBundleWire,
  ContainerMutationRequest,
} from "@tearleads/validators/request";
import { isContainerMutationResponse } from "@tearleads/validators/response";
import { routeApp } from "../../src/routeApp";
import { buildCreateRequest } from "./containerCreateRequests";
import { requestSingleContainerParentLane as listContainersForUser } from "./containerParentLaneQuery";
import {
  type StoredContainerMutation,
  withStoredContainerMutation,
} from "./storedContainerMutation";

export const TEST_CONTACTS_SYSTEM_SLOT =
  "sys_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

type TestCallback = () => Promise<void> | void;

export function test(name: string, run: TestCallback): void {
  bunTest(name, run, 10_000);
}

export function accessManifestFromResponse(
  response: StoredContainerMutation,
): AccessManifestBundleWire {
  return response.accessManifest;
}

export function kekStateFromResponse(
  response: StoredContainerMutation,
): VerifiedContainerKekState {
  return response.containerKek as unknown as VerifiedContainerKekState;
}

export async function postMutation(input: {
  readonly path: string;
  readonly request: ContainerMutationRequest;
  readonly token: string;
}): Promise<Response> {
  return routeApp.request(input.path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.token}`,
    },
    body: JSON.stringify(input.request),
  });
}

export async function postJson(input: {
  readonly path: string;
  readonly request: unknown;
  readonly token: string;
}): Promise<Response> {
  return routeApp.request(input.path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.token}`,
    },
    body: JSON.stringify(input.request),
  });
}

export async function deleteContainerForUser(input: {
  readonly containerId: string;
  readonly token: string;
}): Promise<Response> {
  return routeApp.request(`/containers/${input.containerId}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${input.token}`,
    },
  });
}

export async function listRootContainers(input: {
  readonly token: string;
  readonly watermark?: { id: string; updatedAt: string } | null;
}): Promise<Response> {
  return listContainersForUser({ ...input, parentId: null });
}

export async function expectMutationSuccess(
  response: Response,
): Promise<StoredContainerMutation> {
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(isContainerMutationResponse(body)).toBe(true);
  return withStoredContainerMutation(body);
}

export async function createChild(input: {
  readonly containerId?: string;
  readonly parent: AccessManifestBundleWire;
  readonly parentContainerPath?: readonly AccessManifestBundleWire[];
  readonly parentKekState: VerifiedContainerKekState;
  readonly signer: TestUser;
}): Promise<StoredContainerMutation> {
  const request = await buildCreateRequest({
    containerId: input.containerId ?? crypto.randomUUID(),
    parent: input.parent,
    ...(input.parentContainerPath === undefined
      ? {}
      : { parentContainerPath: input.parentContainerPath }),
    parentKekState: input.parentKekState,
    signer: input.signer,
  });

  return expectMutationSuccess(
    await postMutation({
      path: "/containers",
      request,
      token: input.signer.token,
    }),
  );
}
