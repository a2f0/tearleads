export interface ContainerNode {
  id: string;
  organizationId: string;
  name: string;
  parentId: string | null;
  kind: "container";
}
