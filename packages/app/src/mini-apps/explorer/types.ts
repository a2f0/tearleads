export interface ContainerNode {
  createdAt?: string | null;
  id: string;
  organizationId: string;
  name: string;
  parentId: string | null;
  kind: "container";
  updatedAt?: string | null;
}
