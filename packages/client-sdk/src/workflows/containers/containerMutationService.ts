import type { CreateRemoteContainerResult } from "../../data/containers/shared/types";
import { createRemoteContainer } from "./child/create";
import type { RemoteContainerCreateRequest } from "./child/create/createSubmission";
import {
  type AppliedContainerMove,
  type MoveRemoteContainerRequest,
  moveRemoteContainer,
  replayRemoteContainerMove,
  type SubmittedContainerMove,
} from "./child/move";
import {
  type RekeyedRemoteContainer,
  type RekeyRemoteContainerRequest,
  rekeyRemoteContainer,
} from "./child/rekey/rekeyRemote";
import {
  type RevokedRemoteContainer,
  type RevokeRemoteContainerRequest,
  revokeRemoteContainer,
} from "./child/revoke";
import {
  type SharedRemoteContainer,
  type ShareRemoteContainerRequest,
  shareRemoteContainer,
} from "./child/share";
import type { ContainerMutationCollaborators } from "./containerMutationCollaborators";

/**
 * Container Data: creates, shares, moves, re-keys, and revokes remote
 * containers. One instance binds the API client, executor, encapsulation
 * secret key, incident reporter, and identity resolver of one runtime
 * snapshot; each request carries what varies per call, such as the author,
 * ids, the projection key resolver, the policy warmer, and currency checks.
 */
export class ContainerMutationService {
  private readonly containers: ContainerMutationCollaborators;

  constructor(collaborators: ContainerMutationCollaborators) {
    this.containers = collaborators;
  }

  createRemoteContainer(
    request: RemoteContainerCreateRequest,
  ): Promise<CreateRemoteContainerResult | null> {
    return createRemoteContainer(this.containers, request);
  }

  shareRemoteContainer(
    request: ShareRemoteContainerRequest,
  ): Promise<SharedRemoteContainer | null> {
    return shareRemoteContainer(this.containers, request);
  }

  /** Signs and submits a move; `null` when it was refused or abandoned. */
  moveRemoteContainer(
    request: MoveRemoteContainerRequest,
  ): Promise<SubmittedContainerMove | null> {
    return moveRemoteContainer(this.containers, request);
  }

  /**
   * Replays a queued move. When the verified source head already sits under
   * the destination it signs nothing and returns that head.
   */
  replayRemoteContainerMove(
    request: MoveRemoteContainerRequest,
  ): Promise<
    SubmittedContainerMove | { applied: AppliedContainerMove } | null
  > {
    return replayRemoteContainerMove(this.containers, request);
  }

  rekeyRemoteContainer(
    request: RekeyRemoteContainerRequest,
  ): Promise<RekeyedRemoteContainer | null> {
    return rekeyRemoteContainer(this.containers, request);
  }

  /** A concurrent mutation can advance the path while a revoke is in flight. */
  revokeRemoteContainer(
    request: RevokeRemoteContainerRequest,
  ): Promise<RevokedRemoteContainer | null> {
    return revokeRemoteContainer(this.containers, request);
  }
}
