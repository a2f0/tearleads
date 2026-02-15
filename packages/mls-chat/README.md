# @tearleads/mls-chat

End-to-end encrypted group chat for Tearleads using the Messaging Layer Security (MLS) protocol ([RFC 9420](https://datatracker.ietf.org/doc/rfc9420/)).

> **Implementation Status**: This package currently provides a placeholder implementation with the MLS protocol interface. Full RFC 9420 compliance with production-grade cryptography is planned for a future release via ts-mls library integration.

## Overview

MLS provides forward secrecy and post-compromise security for group messaging. This package provides the client-side MLS protocol interface with:

- **Group key management** - Create, join, and leave encrypted groups
- **Message encryption** - Encrypt/decrypt messages with group keys
- **Member management** - Add/remove members with automatic key rotation
- **Local state persistence** - IndexedDB storage for credentials and group states
- **Real-time updates** - SSE-based message delivery

Target ciphersuite: `MLS_128_DHKEMX25519_CHACHA20POLY1305_SHA256_Ed25519`

## Installation

This package is part of the Tearleads monorepo and is not published independently.

```typescript
import { MlsChatProvider, MlsChat, useMlsClient } from '@tearleads/mls-chat';
```

## Usage

### Provider Setup

Wrap your app with `MlsChatProvider` to supply dependencies:

```tsx
import { MlsChatProvider } from '@tearleads/mls-chat';
import { Button, Input, Avatar, ScrollArea, DropdownMenu, DropdownMenuItem } from '@/components/ui';

function App() {
  return (
    <MlsChatProvider
      apiBaseUrl="https://api.example.com"
      userId={currentUser.id}
      userEmail={currentUser.email}
      getAuthHeader={() => `Bearer ${accessToken}`}
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
} from '@tearleads/mls-chat';
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
} from '@tearleads/mls-chat';
```

| Hook | Description |
|------|-------------|
| `useMlsClient` | Access the MLS client instance for encryption/decryption |
| `useGroups` | Fetch and manage encrypted groups |
| `useGroupMessages` | Fetch and decrypt messages for a group |
| `useGroupMembers` | Manage group membership |
| `useKeyPackages` | Generate and upload key packages for invitations |
| `useWelcomeMessages` | Process Welcome messages to join groups |
| `useMlsRealtime` | Subscribe to real-time message events via SSE |

### Context Hooks

Access provider values from any component:

```tsx
import {
  useMlsChatContext,
  useMlsChatApi,
  useMlsChatUser,
  useMlsChatUI
} from '@tearleads/mls-chat';

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
import { MlsClient, MlsStorage } from '@tearleads/mls-chat';

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

- **Private keys never leave the client** - All encryption happens locally
- **Forward secrecy** - Compromising current keys doesn't expose past messages
- **Post-compromise security** - Key rotation limits exposure from compromise
- **Epoch tracking** - Each group operation increments the epoch for key evolution

## Development

```bash
# Build
pnpm --filter @tearleads/mls-chat build

# Test
pnpm --filter @tearleads/mls-chat test

# Test with coverage
pnpm --filter @tearleads/mls-chat test:coverage
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
} from '@tearleads/mls-chat';
```
