# Client SDK SQLite

This directory contains client SDK SQLite internals: executor adapters,
transaction serialization, Drizzle schema definitions, and shared table helpers.
`sqlitePersistenceRuntime.ts` is the SDK-internal Drizzle/transaction adapter
that sits behind the public `@tearleads/client-sdk/sqlite` executor contracts.

Domain persistence modules under `../persistence/` should import these modules
and expose domain-shaped persistence APIs to stores and workflows. Host
presentation code should stay behind SDK stores or workflow facades, and host
runtime code should import worker-backed SQLite factories from
`@tearleads/client-sdk/sqlite` instead of importing this directory directly.
