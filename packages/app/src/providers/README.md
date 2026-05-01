# App Runtime Providers

This directory contains pane-level runtime providers: host configuration, API
client state, identity, database lifecycle, crypto session state, events,
logging, blob storage, and the aggregate app-data context.

Feature-local providers stay colocated with their feature directories, such as
`mini-apps/*/providers`, document providers under `data/documents/`, and
component-local providers under `components/`.
