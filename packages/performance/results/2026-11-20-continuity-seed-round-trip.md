# Continuity seed round trip, 2026-11-20

One production run of `bun run perf:seed --env production` took 5.79 s to
provision the account, 152.97 s to seed it and 39.71 s to verify it. The
192.68 s round trip recovered 25 documents and 24 attachments (9,604,560
plaintext bytes), including the circular saw, drill and refrigerator photos
and receipts.

See [Continuity seed round trip](../README.md#continuity-seed-round-trip) for
what the run measures and how to repeat it.
