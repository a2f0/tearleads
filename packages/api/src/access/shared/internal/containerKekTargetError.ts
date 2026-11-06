export type ContainerKekTargetStatus = 404 | 409;

export class ContainerKekTargetError extends Error {
  constructor(
    message: string,
    readonly status: ContainerKekTargetStatus,
    // True only for conditions a client can clear by refreshing its state.
    // Integrity failures share the 409 status but are not retryable, so
    // callers must not turn them into a refresh-and-retry instruction.
    readonly stale = false,
  ) {
    super(message);
    this.name = "ContainerKekTargetError";
  }
}

export const staleContainerKekEpochError = (containerId: string) =>
  new ContainerKekTargetError(
    `Container KEK epoch is stale for container ${containerId}`,
    409,
    true,
  );

export const staleContainerKekParentEdgeError = (containerId: string) =>
  new ContainerKekTargetError(
    `Container KEK parent edge is stale for container ${containerId}`,
    409,
    true,
  );
