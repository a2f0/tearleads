const apiDatabaseEnvKey = "API_DATABASE";
process.env[apiDatabaseEnvKey] ??= "postgres";

console.log("Running API database migrations...");
const { closeApiDatabase } = await import("../adapters/postgres");
await closeApiDatabase();
console.log("API database migrations complete.");

export {};
