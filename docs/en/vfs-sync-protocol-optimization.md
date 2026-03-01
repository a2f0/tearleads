# Issue: VFS Sync Protocol Optimization (Binary-First Architecture)

**Status:** In Progress (Greenfield / No Reverse Compatibility)  
**Priority:** High  
**Area:** `@tearleads/vfs-sync`

## Abstract
The current VFS sync protocol is being transitioned to a binary-first architecture using Protocol Buffers (protobuf) and optimized state management to support high-scale sync for mobile and low-bandwidth environments.

---

## 1. Binary Serialization (Protocol Buffers)
**Goal:** Replace JSON with a packed binary format.
- **Status:** **In Progress**. Schema defined. Transport logic being updated to Protobuf-only.
- **Implementation:** `vfs.proto` defines `CrdtOperation`, `SyncPullResponse`, and `SyncPushRequest`.
- **Note:** JSON fallback is being removed to simplify the codebase.

## 2. Compact Binary Cursors
**Goal:** Shrink cursor size to reduce URL length and storage overhead.
- **Status:** **✅ Completed**. 
- **Implementation:** Version 2 packed byte array (Version + Timestamp + UUID). ~70% reduction in string length.

## 3. Server-Side State Snapshots (Differential Sync)
**Goal:** Prevent full-log replay for long-lived or stale clients.
- **Status:** **Proposed**.
- **Implementation:** Periodic materialized snapshots stored in `vfs_crdt_snapshots`.

## 4. Unified Sync Session (Endpoint Pipelining)
**Goal:** Reduce RTT and simplify client state machines.
- **Status:** **Proposed**.
- **Implementation:** Combine `push`, `pull`, and `reconcile` into a single binary sync session.

## 5. Blob Attachment & CRDT Atomic Isolation
**Goal:** Eliminate race conditions between blob commits and item lifecycle.
- **Status:** **Proposed**.

## 6. Vector Clocks / Lamport Timestamps
**Goal:** Resilience against client clock drift.
- **Status:** **Proposed**.

## 7. API-Side SQL Optimization & Read Replicas
**Goal:** Reduce database CPU load and ensure deterministic behavior.
- **Status:** **✅ Completed**.
- **Implementation:** Refactored feeds to use denormalized `vfs_effective_visibility`. Replaced non-deterministic `NOW()` calls with stable cursor-based ordering.

---

## Action Plan
1. [x] Implement Binary Cursor encoding/decoding in `sync-cursor.ts`.
2. [x] Optimize `VFS_SYNC_SQL` / `VFS_CRDT_SYNC_SQL` to use denormalized visibility.
3. [ ] Define `.proto` schema in `packages/vfs-sync/src/vfs/protocol/vfs.proto`. (Schema defined, need to finalize file)
4. [ ] Add `protobufjs` to `package.json` and fix build environment.
5. [ ] Update `VfsHttpCrdtSyncTransport` to be Protobuf-only (No JSON fallback).
6. [ ] Refactor `InMemoryVfsCrdtStateStore` to support snapshotting.
7. [ ] Verify with randomized stress tests in `sync-client.ts`.
