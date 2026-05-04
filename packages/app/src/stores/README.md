# App Stores

Stores own React context adapters, long-lived domain state machines,
subscriptions, sync scheduling, and event fanout.

They sit between presentation code and the lower app layers:

```text
components/document-types/mini-apps -> stores/providers -> workflows -> data
```

Store modules may consume pane runtime providers through `AppDataProvider`, call
workflows, use persistence adapters, and export factory functions for tests.
They should not own screen composition or feature presentation.
