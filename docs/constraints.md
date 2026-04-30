# Constraints

## Container hierarchy depth limit

The maximum depth of a container hierarchy is **100 levels**. This limit is
enforced while resolving signed container manifest paths in
`packages/api/src/services/containers/writerProjection.ts`. The resolver also
rejects parent cycles.
