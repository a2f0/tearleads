# App SQLite

This directory contains app-wide SQLite internals: executor adapters,
transaction serialization, Drizzle schema definitions, and shared table helpers.

Domain persistence modules under `../persistence/` should import these modules
and expose domain-shaped persistence APIs to stores and workflows. Presentation
code should not import this directory directly.
