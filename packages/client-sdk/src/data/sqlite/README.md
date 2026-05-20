# Client SDK SQLite

This directory contains client SDK SQLite internals: executor adapters,
transaction serialization, Drizzle schema definitions, and shared table helpers.

Domain persistence modules under `../persistence/` should import these modules
and expose domain-shaped persistence APIs to stores and workflows. Host
presentation code should stay behind SDK stores or workflow facades instead of
importing this directory directly.
