# Constraints

## Container hierarchy depth limit

The maximum depth of a container hierarchy is **100 levels**. This limit is enforced in the recursive CTE used by `listAncestorContainerIds` in `packages/api/src/access/containerAccess.ts`. It exists to prevent unbounded recursion in PostgreSQL when traversing the container parent chain.
