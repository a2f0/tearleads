# App Stores

Stores own React context adapters, long-lived domain state machines,
subscriptions, sync scheduling, and event fanout.

They sit between presentation code and the lower app layers:

```text
components/document-types/mini-apps -> stores/providers -> workflows -> data
```

Store modules may consume SDK runtime snapshots through
`useSymCryptRuntime`, call workflows, use workflow-exposed persistence
adapters, expose read-model/action helpers for presentation hooks, and export
factory functions for tests. They should not import low-level
`data/persistence/` or `data/sqlite/` modules directly or own screen composition
and feature presentation. Reusable store test fixtures belong under
`packages/app/test/helpers/` rather than production store directories.
