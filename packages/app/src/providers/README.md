# App Runtime Providers

This directory contains pane-level runtime providers and SDK-backed runtime
hooks: host configuration, identity, database lifecycle, crypto session state,
network/events state, logging, blob storage, and the aggregate app-data
context.

`AppRuntimeProvider.tsx` owns the required runtime provider order for a pane.
Presentation code should use that aggregate provider instead of rebuilding the
host/log/SDK/identity/database/session provider stack.

Domain stores and feature-level context adapters live under `../stores/`.
Component-local providers may stay under `components/` when they only support a
local UI subtree.
