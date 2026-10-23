# App Stores

Stores own React context adapters, long-lived domain state machines,
subscriptions, sync scheduling, and event fanout.

They sit between presentation code and the SDK:

```text
components/document-types/mini-apps -> stores/providers -> SDK workflows -> SDK data
```

Store modules may consume SDK runtime snapshots through
`useTearleadsRuntime`, call SDK workflows, use workflow-exposed persistence
adapters, expose read-model/action helpers for presentation hooks, and export
factory functions for tests. They do not reach SDK persistence or SQLite
internals directly, and they do not own screen composition or feature
presentation. Reusable store test fixtures belong under
`packages/app/test/helpers/` rather than production store directories.
