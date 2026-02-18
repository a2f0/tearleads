# @tearleads/vfs-explorer

Virtual file system explorer UI, hooks, and provider wiring for Tearleads.

## Installation

This package is part of the Tearleads monorepo and is not published independently.

## Usage

```typescript
import {
  VfsExplorer,
  VfsExplorerProvider,
  useVfsFolders,
  type VfsItem
} from '@tearleads/vfs-explorer';
```

## Main Exports

- UI: `VfsExplorer`, `VfsWindow`, `VfsTreePanel`, `VfsDetailsPanel`, `VfsWindowMenuBar`
- Provider/context: `VfsExplorerProvider`, `useVfsExplorerContext`, `useVfsExplorerUI`
- Data hooks: `useVfsFolders`, `useVfsFolderContents`, `useCreateVfsFolder`, `useRenameVfsFolder`, `useDeleteVfsFolder`, `useMoveVfsItem`, `useCopyVfsItem`
- IDs/constants: `VFS_ROOT_ID`, `ALL_ITEMS_FOLDER_ID`, `UNFILED_FOLDER_ID`, `TRASH_FOLDER_ID`, `SHARED_BY_ME_FOLDER_ID`, `SHARED_WITH_ME_FOLDER_ID`

## Development

```bash
# Build
pnpm --filter @tearleads/vfs-explorer build

# Test
pnpm --filter @tearleads/vfs-explorer test

# Test with coverage
pnpm --filter @tearleads/vfs-explorer test:coverage
```
