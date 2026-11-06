import { z } from "zod";
import { projectionString } from "../../../keyingProjectionSchemas";
import { ContainerKekTargetError } from "./containerKekTargetError";

/** Stored state: a JSON object, or JSON text that parses to one. */
const storedStateSchema = z.looseObject({});

const stateIdentitySchema = z.object({
  version: z.literal(1),
  containerId: z.string(),
});

const stateKeyEpochSchema = z.object({ containerKeyEpochId: projectionString });

const stateParentSchema = z.object({
  parentContainerId: projectionString.nullable(),
});

export const statePreviousManifestSchema = z.object({
  previousManifestHash: projectionString.nullable(),
});

function parseStoredJson(value: unknown): unknown {
  if (typeof value !== "string" || value.length === 0) {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function readStoredState(value: unknown): Record<string, unknown> {
  const state = storedStateSchema.safeParse(parseStoredJson(value));
  if (!state.success) {
    throw new ContainerKekTargetError(
      "Container manifest state is invalid",
      409,
    );
  }
  return state.data;
}

export function readContainerManifestTarget(input: {
  readonly containerId: string;
  readonly state: unknown;
}): Pick<ContainerManifestTarget, "containerKeyEpochId" | "parentContainerId"> {
  const state = readStoredState(input.state);
  const identity = stateIdentitySchema.safeParse(state);
  if (!identity.success || identity.data.containerId !== input.containerId) {
    throw new ContainerKekTargetError("Container manifest state mismatch", 409);
  }

  const keyEpoch = stateKeyEpochSchema.safeParse(state);
  if (!keyEpoch.success) {
    throw new ContainerKekTargetError(
      "Container manifest has no current KEK epoch",
      409,
    );
  }

  const parent = stateParentSchema.safeParse(state);
  if (!parent.success) {
    throw new ContainerKekTargetError(
      "Container manifest parent is invalid",
      409,
    );
  }

  return {
    containerKeyEpochId: keyEpoch.data.containerKeyEpochId,
    parentContainerId: parent.data.parentContainerId,
  };
}

export type ContainerManifestTarget = {
  readonly containerId: string;
  readonly containerKeyEpochId: string;
  readonly containerManifestHash: string;
  readonly parentContainerId: string | null;
};

export const sqlSafeInteger = z.number().refine(Number.isSafeInteger);
