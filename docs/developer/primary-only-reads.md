# Primary-only database reads

The API defaults to tracked PostgreSQL commit checkpoints. Existing deployments
remain tracked; PostgreSQL itself, a hostname, one URL, and infrastructure
replica declarations do not establish read routing.

The managed-database constructor in
[`api-shared/postgres`](../../packages/api-shared/src/adapters/postgres.ts)
accepts an optional `readRouting` contract. Only the owner of the endpoint and
its complete routing configuration may provide it. It must describe the exact
connection string used by that instance: direct connections to the same writable
primary, no replica reads, and no query cache. Do not derive it from request
input or an unverified environment flag. Unknown, absent, mismatched, replica,
cached, proxy, and custom-stream configurations remain tracked.

The connection URL must explicitly name a PostgreSQL scheme, hostname, port,
user, and database, without `host`, `port`, `user`, or `database` query-parameter
overrides. Incomplete endpoints cannot borrow ambient libpq routing settings.
Credentials are not routing proof, and must not be logged with this contract.

```ts
const database = createDefaultManagedApiDatabase(
  { API_DATABASE: "postgres", DATABASE_URL: directPrimaryUrl },
  {
    readRouting: {
      connectionString: directPrimaryUrl,
      transport: "direct",
      readTarget: "primary",
      queryCache: "disabled",
    },
  },
);
```

Eligibility is local to this database, not process-global. Before exposing each
new native connection, its pool checks that PostgreSQL is not in recovery and
that the session is writable. A failed check discards the connection before
application SQL. Until a connection passes, the instance stays tracked. This
probe verifies server/session properties, **not** the absence of an undisclosed
proxy or cache; the endpoint owner's routing contract remains necessary. Do not
activate it without that operational evidence. Drain and replace the instance
before changing routing; there is no mutable runtime mode switch.

Eligible instances use the existing `commitLsn: "0/0"` and
`commitLsnMode: "untracked"` pair. Their minimum-LSN check does not compare a
numeric fence against the sentinel: primary reads do not need a replica catchup
fence. Paged and direct/unpaged readers use the same policy. Checkpoints are still
constructed after transaction commit for document sync, create seeds, container
metadata seeds, and blob carried sync. Cursor authentication, snapshot bounds,
raw history, access authorization, signed material, and rollback are unchanged.

Tracked instances keep real WAL reads, nonzero checkpoints, minimum-LSN errors,
and the existing single pre-snapshot paginated check. Database capability follows
transaction/savepoint and request-scoped executors; a tracked fallback or another
request does not inherit another instance's eligibility.

This is conditional construction support only. Local PostgreSQL tests establish
its behavior, not production topology, deployment activation, or production
query savings.
