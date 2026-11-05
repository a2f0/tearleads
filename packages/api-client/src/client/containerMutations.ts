import {
  createContainerOperation,
  createContainerWithMetadataDocumentOperation,
  deleteContainerOperation,
  moveContainerOperation,
  reciteContainerOperation,
  rekeyContainerOperation,
  revokeContainerOperation,
  shareContainerOperation,
} from "@tearleads/validators/operation";
import type {
  ContainerCreateWithMetadataDocumentRequest,
  ContainerMutationRequest,
  ContainerReciteRequest,
  ContainerRotationRequest,
} from "@tearleads/validators/request";
import type {
  ContainerCreateWithMetadataDocumentResponse,
  ContainerDeleteResponse,
  ContainerMutationResponse,
  ContainerRotationResponse,
} from "@tearleads/validators/response";
import { bindPrototypeMethods } from "../requestInternals";
import {
  containerCreate,
  containerCreateWithMetadataDocument,
  containerDelete,
  containerMove,
  containerRecite,
  containerRekey,
  containerRevoke,
  containerShare,
} from "../routes/containers/mutations";
import type { RequestResult, RequestResultOptions } from "../types";
import { type ApiClientContext, dataOrNull } from "./apiClientContext";
import type { ApiClientSelf, DeleteContainerOptions } from "./apiClientSelf";

/** The rotations that may carry descendant rekeys, each with its operation. */
const CONTAINER_ROTATIONS = {
  move: { operation: moveContainerOperation, route: containerMove },
  rekey: { operation: rekeyContainerOperation, route: containerRekey },
  revoke: { operation: revokeContainerOperation, route: containerRevoke },
} as const;

/**
 * Container creates, shares, rotations, recitals, and deletes. Every access
 * change clears the writer-projection caches, whatever its outcome.
 */
export class ContainerMutationArea {
  constructor(
    private readonly context: ApiClientContext,
    private readonly self: Pick<
      ApiClientSelf,
      | "clearWriterProjectionCaches"
      | "deleteContainerResult"
      | "shareContainerResult"
    >,
  ) {
    bindPrototypeMethods(this, ContainerMutationArea.prototype);
  }

  private async rotationResult(
    rotation: keyof typeof CONTAINER_ROTATIONS,
    containerId: string,
    input: ContainerRotationRequest,
    options: RequestResultOptions,
  ): Promise<RequestResult<ContainerRotationResponse>> {
    const { operation, route } = CONTAINER_ROTATIONS[rotation];
    try {
      return await this.context.sendResult(
        route,
        route.path(containerId),
        operation,
        input,
        options,
      );
    } finally {
      this.self.clearWriterProjectionCaches();
    }
  }

  createContainer(
    input: ContainerMutationRequest,
    options: RequestResultOptions = {},
  ) {
    return this.context.send(
      containerCreate,
      containerCreate.path,
      createContainerOperation,
      input,
      options,
    );
  }

  async createContainerResult(
    input: ContainerMutationRequest,
    options: RequestResultOptions = {},
  ): Promise<RequestResult<ContainerMutationResponse>> {
    return this.context.sendResult(
      containerCreate,
      containerCreate.path,
      createContainerOperation,
      input,
      options,
    );
  }

  createContainerWithMetadataDocument(
    input: ContainerCreateWithMetadataDocumentRequest,
    options: RequestResultOptions = {},
  ) {
    return this.context.send(
      containerCreateWithMetadataDocument,
      containerCreateWithMetadataDocument.path,
      createContainerWithMetadataDocumentOperation,
      input,
      options,
    );
  }

  createContainerWithMetadataDocumentResult(
    input: ContainerCreateWithMetadataDocumentRequest,
    options: RequestResultOptions = {},
  ): Promise<RequestResult<ContainerCreateWithMetadataDocumentResponse>> {
    return this.context.sendResult(
      containerCreateWithMetadataDocument,
      containerCreateWithMetadataDocument.path,
      createContainerWithMetadataDocumentOperation,
      input,
      options,
    );
  }

  shareContainer(
    containerId: string,
    input: ContainerMutationRequest,
    options: RequestResultOptions = {},
  ) {
    return this.self
      .shareContainerResult(containerId, input, options)
      .then(dataOrNull);
  }

  /** Status-bearing share: a stale path is retryable, a refusal is not. */
  async shareContainerResult(
    containerId: string,
    input: ContainerMutationRequest,
    options: RequestResultOptions = {},
  ): Promise<RequestResult<ContainerMutationResponse>> {
    try {
      return await this.context.sendResult(
        containerShare,
        containerShare.path(containerId),
        shareContainerOperation,
        input,
        options,
      );
    } finally {
      this.self.clearWriterProjectionCaches();
    }
  }

  revokeContainer(
    containerId: string,
    input: ContainerRotationRequest,
    options: RequestResultOptions = {},
  ) {
    return this.rotationResult("revoke", containerId, input, options).then(
      dataOrNull,
    );
  }

  rekeyContainer(
    containerId: string,
    input: ContainerRotationRequest,
    options: RequestResultOptions = {},
  ) {
    return this.rotationResult("rekey", containerId, input, options).then(
      dataOrNull,
    );
  }

  /**
   * Status-bearing rotations: a caller that must tell a permanent refusal (403
   * once ancestor write access is revoked, 402) from a transient 5xx or an
   * offline blip cannot do so through the plain methods, which collapse both to
   * null. They are also how a rotation learns which descendant rekeys it must
   * carry.
   */
  rekeyContainerResult(
    containerId: string,
    input: ContainerRotationRequest,
    options: RequestResultOptions = {},
  ): Promise<RequestResult<ContainerRotationResponse>> {
    return this.rotationResult("rekey", containerId, input, options);
  }

  revokeContainerResult(
    containerId: string,
    input: ContainerRotationRequest,
    options: RequestResultOptions = {},
  ): Promise<RequestResult<ContainerRotationResponse>> {
    return this.rotationResult("revoke", containerId, input, options);
  }

  moveContainerResult(
    containerId: string,
    input: ContainerRotationRequest,
    options: RequestResultOptions = {},
  ): Promise<RequestResult<ContainerRotationResponse>> {
    return this.rotationResult("move", containerId, input, options);
  }

  reciteContainer(
    containerId: string,
    input: ContainerReciteRequest,
    options: RequestResultOptions = {},
  ) {
    return this.context
      .send(
        containerRecite,
        containerRecite.path(containerId),
        reciteContainerOperation,
        input,
        options,
      )
      .finally(() => this.self.clearWriterProjectionCaches());
  }

  moveContainer(
    containerId: string,
    input: ContainerRotationRequest,
    options: RequestResultOptions = {},
  ) {
    return this.rotationResult("move", containerId, input, options).then(
      dataOrNull,
    );
  }

  async deleteContainer(
    containerId: string,
    options: DeleteContainerOptions = {},
  ) {
    const result = await this.self.deleteContainerResult(containerId, options);
    return result.ok ? result.data : null;
  }

  deleteContainerResult(
    containerId: string,
    options: DeleteContainerOptions = {},
  ): Promise<RequestResult<ContainerDeleteResponse>> {
    return this.context
      .sendResult(
        containerDelete,
        containerDelete.path(containerId, options.requiredAncestorId),
        deleteContainerOperation,
        undefined,
        options,
      )
      .finally(() => {
        this.self.clearWriterProjectionCaches();
      });
  }
}
