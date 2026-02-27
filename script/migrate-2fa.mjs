/**
 * 2FA için veritabanı güncellemesi (etkileşimsiz).
 * users tablosuna email sütunu, verification_codes tablosu ekler.
 * Kullanım: node script/migrate-2fa.mjs  veya  npm run db:migrate-2fa
 */
import "dotenv/config";
import pg from "pg";

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("Hata: .env dosyasında DATABASE_URL tanımlı olmalı.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
});

async function run() {
  const client = await pool.connect();
  try {
    console.log("users tablosuna email sütunu ekleniyor...");
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;
    `);
    console.log("email sütunu hazır.");

    console.log("verification_codes tablosu oluşturuluyor...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS verification_codes (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        code VARCHAR(10) NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
    console.log("verification_codes tablosu hazır.");
    console.log("2FA veritabanı güncellemesi tamamlandı.");
  } catch (err) {
    console.error("Migration hatası:", err?.message ?? String(err));
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
