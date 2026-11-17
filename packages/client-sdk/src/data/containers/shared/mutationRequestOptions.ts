export interface ContainerMutationRequestOptions {
  readonly expectedPaymentRequiredOrganizationId?: string | undefined;
  /** A share only: the read-model cursor its sender holds. */
  readonly readModelCursor?: string | undefined;
  readonly reportErrors?: boolean | undefined;
}
