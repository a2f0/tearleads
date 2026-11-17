import type {
  ContainerAccessManifestState,
  ReferencedPrincipalHead,
} from "@tearleads/crypto";
import type { PrincipalPolicyCurrentEvidence } from "../../../data/principalContracts/principalPolicyEvidence";
import type {
  createRuntimeCurrentGroupShare,
  shareRemoteContainerWithGroup,
} from "../../organizations/groupShare";
import type { PrincipalPolicyRuntime } from "../../principals/principalPolicyService";

type GroupShare = typeof shareRemoteContainerWithGroup;

/** What the group operations read from a container contents runtime. */
type GroupShareRuntime = Parameters<typeof createRuntimeCurrentGroupShare>[0];

/** The verified current group a share or rewrap acts on. */
export interface ContainerContentsCurrentGroupPolicy {
  readonly policy: PrincipalPolicyCurrentEvidence;
  /** The group policy and its dependencies, as checkpointed for this read. */
  readonly checkpointPolicies: readonly PrincipalPolicyCurrentEvidence[];
  readonly stillCurrent: () => boolean;
}

/**
 * Runs `work` on the group's current policy under a current principal
 * mutation lease, after the group's name and expected head are checked.
 */
export type ContainerContentsCurrentGroupPolicyReader = <Result>(
  input: {
    readonly expectedGroupHead?: ReferencedPrincipalHead | undefined;
    readonly expectedGroupName?: string | undefined;
    readonly groupId: string;
    readonly organizationId: string;
    readonly stillCurrent: () => boolean;
  },
  work: (current: ContainerContentsCurrentGroupPolicy) => Promise<Result>,
) => Promise<Result>;

/**
 * The Organization Read Models operations container contents runs. Group
 * shares, group metadata, and the organization directory belong to the
 * organization workflows, which sit above container contents; the composition
 * root binds their implementations here so container contents never imports
 * them.
 */
export interface ContainerContentsOrganizationHost {
  /** Shares with a group on current evidence; `undefined` without private paged recovery. */
  readonly createCurrentGroupShare: (
    runtime: GroupShareRuntime,
  ) => GroupShare | undefined;
  /** Reads current group policy; `undefined` without private paged recovery. */
  readonly createCurrentGroupPolicyReader: (
    runtime: GroupShareRuntime,
  ) => ContainerContentsCurrentGroupPolicyReader | undefined;
  /** Decrypts a group's name from the organization's signed metadata container. */
  readonly groupMetadataNameReader: (
    runtime: GroupShareRuntime,
    organizationId: string,
    stillCurrent: (() => boolean) | undefined,
  ) => NonNullable<Parameters<GroupShare>[0]["readEncryptedName"]>;
  /** Checks a metadata root destination against the current organization authority. */
  readonly verifyGroupMetadataAuthority: (input: {
    readonly runtime: PrincipalPolicyRuntime;
    readonly organizationId: string;
    readonly state: ContainerAccessManifestState;
    readonly organizationReference?: ReferencedPrincipalHead | undefined;
    readonly stillCurrent: () => boolean;
  }) => Promise<void>;
  /**
   * Runs `load` again once, after `evictRoot`, when the metadata root it read
   * was behind the signed directory; a root still behind is an incident.
   */
  readonly withMetadataRootReload: <Result>(
    load: (reread: boolean) => Promise<Result>,
    evictRoot: () => void,
  ) => Promise<Result>;
}
