# @tearleads/app-mls-chat

Group chat UI and client workflows for Messaging Layer Security (MLS) style flows in Tearleads.

> **Implementation Status**: This package is backed by Rust/WASM MLS primitives from `@tearleads/mls-core` for credential/key-package flows, commit processing, authenticated message encryption/decryption, and validated state materialization.

## Overview

This package provides the client-side MLS protocol interface and UI integration with:

- **Group key management** - Create, join, and leave encrypted groups
- **Message crypto hooks** - Encrypt/decrypt interface for group messages
- **Member management** - Add/remove members with automatic key rotation
- **Local state persistence** - IndexedDB storage for credentials and group states
- **Real-time updates** - Shared notification stream manager delivery

Target ciphersuite: `MLS_128_DHKEMX25519_CHACHA20POLY1305_SHA256_Ed25519`

## Installation

This package is part of the Tearleads monorepo and is not published independently.

```typescript
import { MlsChatProvider, MlsChat, useMlsClient } from '@tearleads/app-mls-chat';
```

## Usage

### Provider Setup

Wrap your app with `MlsChatProvider` to supply dependencies:

```tsx
import { MlsChatProvider } from '@tearleads/app-mls-chat';
import { createMlsV2Routes } from '@tearleads/api-client/mlsRoutes';
import { useSSE } from '@/sse';
import { Button, Input, Avatar, ScrollArea, DropdownMenu, DropdownMenuItem } from '@/components/ui';

function App() {
  const { connectionState, lastMessage, addChannels, removeChannels } = useSSE();
  const mlsRoutes = createMlsV2Routes({
    resolveApiBaseUrl: () => 'https://api.example.com',
    getAuthHeaderValue: () => `Bearer ${accessToken}`
  });

  return (
    <MlsChatProvider
      apiBaseUrl="https://api.example.com"
      userId={currentUser.id}
      userEmail={currentUser.email}
      getAuthHeader={() => `Bearer ${accessToken}`}
      mlsRoutes={mlsRoutes}
      realtime={{
        connectionState,
        lastMessage,
        addChannels,
        removeChannels
      }}
      ui={{
        Button,
        Input,
        Avatar,
        ScrollArea,
        DropdownMenu,
        DropdownMenuItem
      }}
    >
      <MlsChat />
    </MlsChatProvider>
  );
}
```

### Using Components

The package exports pre-built components for common chat UI patterns:

```tsx
import {
  MlsChatWindow,
  GroupList,
  MemberList,
  MlsComposer,
  MlsMessage,
  NewGroupDialog,
  AddMemberDialog
} from '@tearleads/app-mls-chat';
```

| Component | Description |
|-----------|-------------|
| `MlsChat` | Full-page chat UI with group list and message window |
| `MlsChatWindow` | Message display area with real-time updates |
| `GroupList` | Sidebar showing available encrypted groups |
| `MemberList` | List of group members with management actions |
| `MlsComposer` | Message input with encryption |
| `MlsMessage` | Individual decrypted message display |
| `NewGroupDialog` | Dialog for creating a new encrypted group |
| `AddMemberDialog` | Dialog for inviting members to a group |

### Using Hooks

For custom implementations, use the provided hooks:

```tsx
import {
  useMlsClient,
  useGroups,
  useGroupMessages,
  useGroupMembers,
  useKeyPackages,
  useWelcomeMessages,
  useMlsRealtime
} from '@tearleads/app-mls-chat';
```

| Hook | Description |
|------|-------------|
| `useMlsClient` | Access the MLS client instance for encryption/decryption |
| `useGroups` | Fetch and manage encrypted groups |
| `useGroupMessages` | Fetch and decrypt messages for a group |
| `useGroupMembers` | Manage group membership |
| `useKeyPackages` | Generate and upload key packages for invitations |
| `useWelcomeMessages` | Process Welcome messages to join groups |
| `useMlsRealtime` | Subscribe to real-time message events via shared realtime bridge |

### Context Hooks

Access provider values from any component:

```tsx
import {
  useMlsChatContext,
  useMlsChatApi,
  useMlsChatUser,
  useMlsChatUI
} from '@tearleads/app-mls-chat';

function MyComponent() {
  const { apiBaseUrl, getAuthHeader } = useMlsChatApi();
  const { userId, userEmail } = useMlsChatUser();
  const { Button, Input } = useMlsChatUI();
  // ...
}
```

### Direct MLS Client Usage

For advanced use cases, access the MLS client directly:

```tsx
import { MlsClient, MlsStorage } from '@tearleads/app-mls-chat';

const storage = new MlsStorage();
const client = new MlsClient(userId, storage);
await client.init();

// Generate credential and key packages
await client.generateCredential();
const keyPackage = await client.generateKeyPackage();

// Create a group
const groupState = await client.createGroup(groupId);

// Join via Welcome message
await client.joinGroup(groupId, welcomeBytes, keyPackageRef);

// Encrypt/decrypt messages
const ciphertext = await client.encryptMessage(groupId, plaintext);
const { senderId, plaintext } = await client.decryptMessage(groupId, ciphertext);

// Member management
const { commit, welcome } = await client.addMember(groupId, memberKeyPackage);
await client.removeMember(groupId, leafIndex);
```

## Architecture

### Local Storage

MLS state is persisted in IndexedDB (`tearleads-mls` database):

| Store | Key | Contents |
|-------|-----|----------|
| `credentials` | userId | MLS credential bundle and private key |
| `keyPackages` | ref | Unused key packages for group invitations |
| `groupStates` | groupId | Serialized MLS group state and epoch |

### Security Model

- **Rust/WASM-backed primitives** - Core MLS operations are executed in the Rust backend consumed through wasm bindings.
- **Authenticated sender metadata** - Message decryption resolves sender identity from authenticated MLS metadata, not transport metadata.
- **Epoch-based state handling** - Group state transitions and snapshot import/export are validated before local materialization.

## Development

```bash
# Build
pnpm --filter @tearleads/app-mls-chat build

# Test
pnpm --filter @tearleads/app-mls-chat test

# Test with coverage
pnpm --filter @tearleads/app-mls-chat test:coverage
```

## Types

Key type exports:

```typescript
import type {
  ActiveGroup,
  DecryptedMessage,
  LocalKeyPackage,
  LocalMlsState,
  MlsCredential,
  MlsChatContextValue,
  MlsChatProviderProps,
  MlsChatUIComponents,
  SseConnectionState
} from '@tearleads/app-mls-chat';
```
