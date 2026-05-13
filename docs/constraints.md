# Constraints

For shared protocol terminology, see [glossary.md](./glossary.md).

## Container hierarchy depth limit

The maximum depth of a container hierarchy is **100 levels**. This limit is
enforced via the recursive CTE condition `ap.depth < 100` in
`packages/api/src/access/shared/internal/containerKekTargets.ts`. The resolver
also rejects parent cycles.
