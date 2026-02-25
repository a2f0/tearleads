# Client Layer

Background sync runtime and client harnesses:

- Sync loop and queue management
- Pending operation and persistence handling
- Test harnesses/shards for restart/replay/race/failure coverage

Client behavior may depend on protocol and transport abstractions.

Rematerialization guardrail:

- Pull loops treat `crdt_rematerialization_required` as a hard stale-cursor signal.
- Client retries with bounded attempts (`maxRematerializationAttempts`) after applying rematerialized canonical state provided by `onRematerializationRequired`.
