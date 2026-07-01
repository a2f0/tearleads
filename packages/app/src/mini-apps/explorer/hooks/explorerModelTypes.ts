import type {
  ContainerNode,
  DocumentSummary,
  LocalProjectionView,
  ReconciliationService,
} from "@tearleads/client-sdk";

export interface ExplorerModelExplorer {
  canResolveTrashContainer: boolean;
  contactsSystemSlot: NonNullable<ContainerNode["systemSlot"]> | null;
  createChild: (
    parentId: string,
    name: string,
  ) => Promise<ContainerNode | null>;
  deleteContainer: (containerId: string) => Promise<boolean>;
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
  purgeContainer: (containerId: string) => Promise<boolean>;
  refresh: () => Promise<boolean>;
  renameContainer: (
    containerId: string,
    name: string,
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
