import { defineConfig } from "drizzle-kit";

process.env.API_DATABASE = "sqlite";

export default defineConfig({
  dialect: "sqlite",
  out: "./drizzle-sqlite",
  schema: "./src/schema.ts",
});
