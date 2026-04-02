export interface ContainerNode {
  id: string;
  name: string;
  parentId: string | null;
  kind: "container";
}
