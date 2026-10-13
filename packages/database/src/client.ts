import 'dotenv/config';
import { Pool, type PoolClient } from 'pg';

const connectionString = process.env.SERTIKI_DATABASE_URL;

if (!connectionString) {
  throw new Error('SERTIKI_DATABASE_URL is required. Copy .env.example to .env.');
}

export const postgres = new Pool({ connectionString, max: 10 });

export async function withTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await postgres.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

