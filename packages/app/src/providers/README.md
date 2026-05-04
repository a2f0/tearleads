# App Runtime Providers

This directory contains pane-level runtime providers: host configuration, API
client state, identity, database lifecycle, crypto session state, events,
logging, blob storage, and the aggregate app-data context.

Domain stores and feature-level context adapters live under `../stores/`.
Component-local providers may stay under `components/` when they only support a
local UI subtree.
