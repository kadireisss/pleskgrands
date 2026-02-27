import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

let pool: pg.Pool | null = null;
let db: any = null;

if (process.env.DATABASE_URL) {
  const ssl = process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false };
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    ...(ssl && { ssl }),
  });
  db = drizzle(pool, { schema });
} else {
  console.warn("[DB] DATABASE_URL not set - database features will be unavailable. User CRUD API will return errors.");
}

export { pool, db };
