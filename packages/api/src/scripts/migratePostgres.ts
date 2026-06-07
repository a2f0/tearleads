const apiDatabaseEnvKey = "API_DATABASE";
process.env[apiDatabaseEnvKey] ??= "postgres";

console.log("Running API database migrations...");
const { closeApiDatabase, initializeApiDatabase } = await import(
  "../adapters/postgres"
);
await initializeApiDatabase();
await closeApiDatabase();
console.log("API database migrations complete.");

export {};
