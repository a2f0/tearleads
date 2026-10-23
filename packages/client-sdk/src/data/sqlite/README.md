# Client SDK SQLite

This directory holds client SDK SQLite internals: executor adapters,
transaction serialization, Drizzle schema definitions, and shared table helpers.
`sqlitePersistenceRuntime.ts` is the Drizzle/transaction adapter behind the
public `@tearleads/client-sdk/sqlite` executor contracts.

Domain persistence modules under `../persistence/` import these modules and
expose domain-shaped persistence APIs to stores and workflows. Host
presentation code stays behind SDK stores or workflow facades, and host runtime
code imports worker-backed SQLite factories from `@tearleads/client-sdk/sqlite`
instead of this directory.
