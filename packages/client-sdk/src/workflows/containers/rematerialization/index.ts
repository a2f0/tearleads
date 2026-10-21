// A principal policy change re-wraps every container it grants or revokes.
// Group-policy commits and group shares prepare that batch through this surface.
export {
  type PreparedPrincipalContainerRematerializationBatch,
  preparePrincipalContainerRematerializationBatch,
} from "./principalContainerRematerialization";
export type { PrincipalRematerializationPredecessor } from "./principalContainerRematerializationPlanning";
