import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./migrations",
  dbCredentials: {
    // drizzle-kit solo lo usa para `drizzle-kit push/studio`. Las migraciones
    // del proyecto corren con `npm run db:migrate`, que funciona contra PGlite
    // (local) o Supabase (DATABASE_URL) sin cambiar nada.
    url: process.env.DATABASE_URL ?? "postgres://local:local@localhost:5432/local",
  },
  strict: true,
  verbose: true,
});
