import { defineConfig } from "drizzle-kit";
import { readMigrationDatabaseConfig } from "./src/server/db/config";

const database = readMigrationDatabaseConfig(process.env);

export default defineConfig({
  dialect: "postgresql",
  schema: ["./src/server/db/schema.ts", "./src/server/db/auth-schema.ts"],
  out: "./db/migrations",
  dbCredentials: {
    host: database.host,
    port: database.port,
    user: database.user,
    password: database.password,
    database: database.database,
    ssl: database.ssl,
  },
});
