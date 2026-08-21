import type {
  ContainerNode,
  DocumentSummary,
  LocalProjectionView,
  PurgeOptions,
  ReconciliationService,
} from "@symcrypt/client-sdk";
import type { BuiltInSystemContainer } from "../../../stores/systemContainers";

export interface ExplorerModelExplorer {
  builtInSystemContainers: ReadonlyArray<BuiltInSystemContainer>;
  canResolveTrashContainer: boolean;
  contactsSystemSlot: NonNullable<ContainerNode["systemSlot"]> | null;
  createChild: (
    parentId: string,
    name: string,
  ) => Promise<ContainerNode | null>;
  ensureTrashContainer: () => Promise<ContainerNode | null>;
  ensureSystemContainer: (
    systemSlot: NonNullable<ContainerNode["systemSlot"]>,
    name: string,
    options?: {
      deferRemoteBootstrap?: boolean | undefined;
      icon?: string | null | undefined;
      skipAdvancedManagedRoot?: boolean | undefined;
    },
  ) => Promise<ContainerNode | null>;
  moveContainer: (
    containerId: string,
    parentId: string,
  ) => Promise<ContainerNode | null>;
  purgeContainer: (
    containerId: string,
    options?: PurgeOptions,
  ) => Promise<boolean>;
  emptyTrash: (
    trashContainerId: string,
    options?: PurgeOptions,
  ) => Promise<boolean>;
  refresh: () => Promise<boolean>;
  renameContainer: (
    containerId: string,
    name: string,
  ) => Promise<ContainerNode | null>;
  setContainerIcon: (
    containerId: string,
    icon: string | null,
  ) => Promise<ContainerNode | null>;
  shareWithGroup: (
    containerId: string,
    groupId: string,
    accessLevel: "admin" | "read" | "write",
  ) => Promise<boolean>;
  shareWithUser: (containerId: string, userId: string) => Promise<boolean>;
  nodes: ReadonlyArray<ContainerNode>;
  ready: boolean;
  reconciler: ReconciliationService;
  trashContainerId: string | null;
  trashSystemSlot: NonNullable<ContainerNode["systemSlot"]> | null;
  view: LocalProjectionView;
  visibleSystemSlots: ReadonlySet<NonNullable<ContainerNode["systemSlot"]>>;
}

export interface ExplorerDocumentMutationOptions {
  replaceLinkedContainers?: boolean | undefined;
  sourceContainerId?: string | null | undefined;
}

export type ExplorerDocumentMutationAction = (
  documentId: string,
  targetContainerId: string,
  options?: ExplorerDocumentMutationOptions,
) => Promise<DocumentSummary | null>;
