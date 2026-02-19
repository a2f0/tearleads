# @tearleads/sync

Compatibility shim for `@tearleads/vfs-sync`.

## Purpose

This package preserves legacy imports while delegating implementation to
`@tearleads/vfs-sync`.

## Exports

- `@tearleads/sync`
- `@tearleads/sync/vfs`

## Notes

- Runtime behavior is provided by `@tearleads/vfs-sync`.
- Keep this package minimal and avoid adding standalone sync logic here.
