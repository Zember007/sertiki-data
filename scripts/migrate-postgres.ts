import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { postgres } from '../packages/database/src/client.js';

async function main(): Promise<void> {
  const directory = path.resolve('migrations');
  const files = (await readdir(directory)).filter((file) => file.endsWith('.sql')).sort();
  await postgres.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  for (const file of files) {
    const alreadyApplied = await postgres.query('SELECT 1 FROM schema_migrations WHERE name = $1', [file]);
    if (alreadyApplied.rowCount) continue;
    const sql = await readFile(path.join(directory, file), 'utf8');
    const client = await postgres.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`Applied ${file}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }
  await postgres.end();
}
main().catch((error) => { console.error(error); process.exitCode = 1; });

