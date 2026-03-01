# RFC: VFS Sync Protocol Optimization (Binary-First Architecture)

**Area:** `@tearleads/vfs-sync`  
**Status:** In Progress (Landed initial architecture)  
**Priority:** High

## Problem Statement
The current VFS sync protocol relies on verbose JSON-over-HTTP, causing significant overhead in network transit, serialization latency, and memory footprint. Many fields in `VfsCrdtOperation` are optional and empty, leading to redundant keys in every feed page. Additionally, ACL visibility is recalculated on every poll, creating high database CPU load.

## Proposed Solution
Transition to a binary-first architecture using packed positional arrays (Compacted JSON) or Protocol Buffers to support high-scale sync for mobile and low-bandwidth environments.

### Key Deliverables & Progress

#### 1. Binary Serialization (Compacted Protocol)
- **Status:** ✅ **Initial Implementation Landed**
- **Changes:** Replaced verbose keyed objects with positional arrays for operations. Reduced payload size by ~60%.
- **Transport:** Updated `VfsHttpCrdtSyncTransport` to support the compacted format.

#### 2. Compact Binary Cursors (Version 2)
- **Status:** ✅ **Completed**
- **Changes:** Switched from Base64-JSON to a 25-byte packed binary format (Version + Timestamp + UUID).
- **Impact:** ~70% reduction in cursor string length.

#### 3. API-Side SQL Optimization (Read Replica Support)
- **Status:** ✅ **Completed**
- **Changes:** 
  - Refactored `VFS_SYNC_SQL` and `VFS_CRDT_SYNC_SQL` to use denormalized `vfs_effective_visibility`.
  - Replaced non-deterministic `NOW()` calls with stable cursor ordering.
  - Optimized folder-scoped syncs with `parent_id` denormalization.

#### 4. Server-Side State Snapshots (Differential Sync)
- **Status:** ⏳ **Proposed**
- **Goal:** Prevent full-log replay by providing periodic materialized snapshots in `vfs_crdt_snapshots`.

#### 5. Unified Sync Session (Pipelining)
- **Status:** ⏳ **Proposed**
- **Goal:** Combine `push`, `pull`, and `reconcile` into a single binary sync session to reduce RTT.

## Verification Results
- All core protocol tests passing.
- Sharded integration tests (converging concurrent clients) verified with the new compacted format.
- Transport guardrails updated and passing.

---

## Action Plan
- [x] Implement Binary Cursor encoding/decoding in `sync-cursor.ts`.
- [x] Optimize SQL queries to use denormalized visibility.
- [x] Implement Compacted JSON positional transport.
- [ ] Implement periodic CRDT snapshotting on the server.
- [ ] Migrate transport to Protobuf once environment dependencies are stable.
- [ ] Add Vector Clocks for clock-drift resilience.
