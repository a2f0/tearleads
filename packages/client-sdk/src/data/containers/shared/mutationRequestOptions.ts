export interface ContainerMutationRequestOptions {
  readonly expectedPaymentRequiredOrganizationId?: string | undefined;
  /** A share only: the read-model cursor its sender holds. */
  readonly readModelCursor?: string | undefined;
  readonly reportErrors?: boolean | undefined;
  /** Retires the request, its session renewal and any replay once false. */
  readonly stillCurrent?: (() => boolean) | undefined;
}
