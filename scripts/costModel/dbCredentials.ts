/**
 * Check database credentials before running db-dependent commands.
 */
export async function requireDbCredentials(): Promise<void> {
  const db = await import('./db/postgres');
  const { valid, missing } = db.checkPostgresEnvVars();
  if (!valid) {
    console.error('Missing required environment variables:');
    for (const key of missing) {
      console.error(`   - ${key}`);
    }
    console.error('\nSet these variables before running database commands:');
    console.error('  export POSTGRES_READ_ONLY_USER=costmodel_ro');
    console.error('  export POSTGRES_READ_ONLY_PASSWORD=<password>');
    console.error('  export POSTGRES_DATABASE=<database>');
    console.error(
      '  export POSTGRES_HOST=<host>  # optional, default: localhost'
    );
    console.error('  export POSTGRES_PORT=<port>  # optional, default: 5432');
    process.exit(1);
  }
}
