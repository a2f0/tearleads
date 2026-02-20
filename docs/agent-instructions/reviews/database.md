# Database Standards

This codebase uses **Drizzle ORM** with PostgreSQL (primary) and SQLite (fallback).

## Schema Location

- **Schema definitions** - `/packages/db/src/schema/`
- **Migrations** - `/packages/api/src/migrations/v*.ts`
- **Type mappings** - `getPostgresTypeInfo()`, `getSqliteTypeInfo()`

## Query Patterns

### Parameterized Queries

Always use parameterized queries to prevent SQL injection:

```typescript
// GOOD: Drizzle ORM (auto-parameterized)
await db.select().from(users).where(eq(users.id, userId));

// GOOD: Raw query with parameters
await pool.query("SELECT * FROM users WHERE id = $1", [userId]);

// BAD: String interpolation
await pool.query(`SELECT * FROM users WHERE id = '${userId}'`);  // NEVER
```

### Avoid N+1 Queries

Flag loops that make individual database calls:

```typescript
// BAD: N+1 query pattern
const users = await db.select().from(users);
for (const user of users) {
  const posts = await db.select().from(posts).where(eq(posts.userId, user.id));  // N queries!
}

// GOOD: Use JOIN
const usersWithPosts = await db
  .select()
  .from(users)
  .leftJoin(posts, eq(users.id, posts.userId));

// GOOD: Use IN clause
const userIds = users.map((u) => u.id);
const allPosts = await db
  .select()
  .from(posts)
  .where(inArray(posts.userId, userIds));
```

### Batch Operations

Use batch inserts/updates for multiple records:

```typescript
// GOOD: Batch insert
await db.insert(users).values([
  { name: "Alice", email: "alice@test.com" },
  { name: "Bob", email: "bob@test.com" },
]);

// BAD: Individual inserts in loop
for (const user of newUsers) {
  await db.insert(users).values(user);  // Slow!
}
```

## Migration Patterns

### Structure

Migrations are versioned sequentially:

```typescript
// packages/api/src/migrations/v001.ts
export const v001: Migration = {
  version: 1,
  description: "Initial schema with users table",
  up: async (pool: Pool) => {
    const statements = [
      `CREATE TABLE IF NOT EXISTS "users" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "email" TEXT NOT NULL UNIQUE,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS "users_email_idx" ON "users" ("email")`,
    ];

    for (const sql of statements) {
      await pool.query(sql);
    }
  },
};
```

### Rules

- Versions must be sequential (1, 2, 3...)
- Use raw SQL, not Drizzle ORM in migrations
- Include `IF NOT EXISTS` / `IF EXISTS` for idempotency
- Create indexes for frequently queried columns
- Use `ON DELETE CASCADE` for foreign keys that should cascade

### Adding Columns

```typescript
// Add column with default (no lock on small tables)
`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "status" TEXT DEFAULT 'active'`

// Add NOT NULL column (requires default or backfill)
`ALTER TABLE "users" ADD COLUMN "verified" BOOLEAN NOT NULL DEFAULT false`
```

## Transaction Patterns

### Explicit Transactions

```typescript
// GOOD: Transaction with rollback on error
async function transferFunds(fromId: string, toId: string, amount: number) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      "UPDATE accounts SET balance = balance - $1 WHERE id = $2",
      [amount, fromId]
    );
    await client.query(
      "UPDATE accounts SET balance = balance + $1 WHERE id = $2",
      [amount, toId]
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
```

### Transaction State Tracking

For complex operations, track transaction state explicitly:

```typescript
async function complexOperation() {
  let inTransaction = false;

  try {
    await pool.query("BEGIN");
    inTransaction = true;

    // Multiple operations...

    await pool.query("COMMIT");
    inTransaction = false;
  } catch (error) {
    if (inTransaction) {
      await pool.query("ROLLBACK");
    }
    throw error;
  }
}
```

## Index Guidelines

### When to Add Indexes

- Columns used in `WHERE` clauses frequently
- Columns used in `JOIN` conditions
- Columns used in `ORDER BY`
- Foreign key columns

### Index Types

```sql
-- Single column index
CREATE INDEX "users_email_idx" ON "users" ("email");

-- Composite index (order matters for queries)
CREATE INDEX "posts_user_date_idx" ON "posts" ("user_id", "created_at" DESC);

-- Unique constraint (also creates index)
ALTER TABLE "users" ADD CONSTRAINT "users_email_unique" UNIQUE ("email");
```

## Schema Conventions

### Table Names

- Use lowercase with underscores: `user_sessions`, `api_keys`
- Plural form: `users`, `posts`, `comments`

### Column Names

- Use lowercase with underscores: `created_at`, `user_id`
- Foreign keys: `{table_singular}_id` (e.g., `user_id`)
- Timestamps: `created_at`, `updated_at`, `deleted_at`

### Default Values

```sql
-- Timestamps
"created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()

-- UUIDs
"id" UUID PRIMARY KEY DEFAULT gen_random_uuid()

-- Booleans
"is_active" BOOLEAN NOT NULL DEFAULT true
```

## Review Checklist

- [ ] Queries are parameterized (no string interpolation)
- [ ] No N+1 query patterns (loops with queries)
- [ ] Batch operations for multiple inserts/updates
- [ ] Transactions for multi-step operations
- [ ] Rollback on error in transactions
- [ ] Indexes on frequently queried columns
- [ ] Foreign keys have `ON DELETE` behavior defined
- [ ] Migrations are idempotent (IF NOT EXISTS)
- [ ] Migration versions are sequential
