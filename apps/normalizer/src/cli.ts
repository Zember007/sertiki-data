import 'dotenv/config';
import mysql from 'mysql2/promise';
import type { PoolClient } from 'pg';
import { postgres, withTransaction } from '../../../packages/database/src/client.js';
import type { NormalizedDocument, RawDocumentRow, SourceType } from '../../../packages/domain/src/types.js';
import { normalizeDocument } from '../../../packages/normalization/src/normalize.js';

type SourceArg = 'declarations' | 'certificates';
interface Options { source: SourceArg; limit?: number; batchSize: number; fromId?: number; toId?: number; reset: boolean }

function parseOptions(argv: string[]): Options {
  const read = (name: string) => { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] : undefined; };
  const source = read('--source') as SourceArg | undefined;
  if (source !== 'declarations' && source !== 'certificates') throw new Error('--source declarations|certificates is required');
  const integer = (name: string) => { const value = read(name); if (value === undefined) return undefined; const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer`); return parsed; };
  return { source, limit: integer('--limit'), batchSize: integer('--batch-size') ?? Number(process.env.NORMALIZER_BATCH_SIZE ?? 5000), fromId: integer('--from-id'), toId: integer('--to-id'), reset: argv.includes('--reset') };
}

function sourceInfo(source: SourceArg): { table: string; sourceType: SourceType } {
  return source === 'declarations' ? { table: 'pf_declaration', sourceType: 'declaration' } : { table: 'pf_certificate', sourceType: 'certificate' };
}

const COMMON_SELECT_FIELDS = 'id, created_at, updated_at, status, number, dateBegin, dateEnd, technicalReglaments, productOrig, productFullName, productTnved, productOkpd2, groupEaes, groupRu, singleListEEU, singleListRU, strana';

function selectFields(source: SourceArg): string {
  // The source tables have distinct document-type columns. Selecting an absent
  // field causes MySQL to stop before the first batch, so represent the other
  // document type as NULL with the same result shape for the normalizer.
  return source === 'declarations'
    ? `${COMMON_SELECT_FIELDS}, declType, NULL AS certType`
    : `${COMMON_SELECT_FIELDS}, NULL AS declType, certType`;
}

async function persistBatch(client: PoolClient, documents: NormalizedDocument[]): Promise<void> {
  const retainRaw = process.env.NORMALIZER_RETAIN_RAW === '1';
  const json = JSON.stringify(documents.map((document) => ({
    source_type: document.sourceType,
    source_id: document.sourceId,
    document_number: document.documentNumber,
    document_type_raw: retainRaw ? document.documentTypeRaw : null,
    document_type_normalized: document.documentTypeNormalized,
    status_raw: retainRaw ? document.statusRaw : null,
    status_normalized: document.statusNormalized,
    date_begin: document.dateBegin,
    date_end: document.dateEnd,
    product_name_raw: retainRaw ? document.productNameRaw : null,
    product_name_normalized: document.productNameNormalized,
    product_origin_raw: retainRaw ? document.productOriginRaw : null,
    product_origin_normalized: retainRaw ? document.productOriginNormalized : null,
    country: retainRaw ? document.country : null,
    source_created_at: document.sourceCreatedAt,
    source_updated_at: document.sourceUpdatedAt,
    tnved_codes: document.tnvedCodes,
    okpd2_codes: document.okpd2Codes,
    regulations: document.regulations,
    regulations_raw: retainRaw ? document.regulationsRaw : null,
    product_groups: document.productGroups.map((group) => ({
      type: group.type,
      raw: retainRaw ? group.raw : group.normalized,
      normalized: group.normalized,
    })),
  })));
  await client.query(`
    INSERT INTO documents (source_type, source_id, document_number, document_type_raw, document_type_normalized, status_raw, status_normalized, date_begin, date_end, product_name_raw, product_name_normalized, product_origin_raw, product_origin_normalized, country, source_created_at, source_updated_at)
    SELECT source_type::source_type, source_id, document_number, document_type_raw, document_type_normalized, status_raw, status_normalized, date_begin::date, date_end::date, product_name_raw, product_name_normalized, product_origin_raw, product_origin_normalized, country, source_created_at::timestamp, source_updated_at::timestamp
    FROM jsonb_to_recordset($1::jsonb) AS x(source_type text, source_id bigint, document_number text, document_type_raw text, document_type_normalized text, status_raw text, status_normalized text, date_begin text, date_end text, product_name_raw text, product_name_normalized text, product_origin_raw text, product_origin_normalized text, country text, source_created_at text, source_updated_at text)
    ON CONFLICT (source_type, source_id) DO UPDATE SET
      document_number = EXCLUDED.document_number, document_type_raw = EXCLUDED.document_type_raw, document_type_normalized = EXCLUDED.document_type_normalized, status_raw = EXCLUDED.status_raw, status_normalized = EXCLUDED.status_normalized, date_begin = EXCLUDED.date_begin, date_end = EXCLUDED.date_end, product_name_raw = EXCLUDED.product_name_raw, product_name_normalized = EXCLUDED.product_name_normalized, product_origin_raw = EXCLUDED.product_origin_raw, product_origin_normalized = EXCLUDED.product_origin_normalized, country = EXCLUDED.country, source_created_at = EXCLUDED.source_created_at, source_updated_at = EXCLUDED.source_updated_at, updated_at = now()`, [json]);

  const cleanup = `WITH rows AS (SELECT source_type::source_type AS source_type, source_id FROM jsonb_to_recordset($1::jsonb) AS x(source_type text, source_id bigint)), targets AS (SELECT d.id FROM documents d JOIN rows r USING (source_type, source_id))`;
  await client.query(`${cleanup} DELETE FROM document_tnved WHERE document_id IN (SELECT id FROM targets)`, [json]);
  await client.query(`${cleanup} DELETE FROM document_okpd2 WHERE document_id IN (SELECT id FROM targets)`, [json]);
  await client.query(`${cleanup} DELETE FROM document_regulations WHERE document_id IN (SELECT id FROM targets)`, [json]);
  await client.query(`${cleanup} DELETE FROM document_product_groups WHERE document_id IN (SELECT id FROM targets)`, [json]);

  await client.query(`INSERT INTO tnved_codes(code) SELECT DISTINCT jsonb_array_elements_text(x.tnved_codes) FROM jsonb_to_recordset($1::jsonb) AS x(tnved_codes jsonb) ON CONFLICT DO NOTHING`, [json]);
  await client.query(`INSERT INTO okpd2_codes(code) SELECT DISTINCT jsonb_array_elements_text(x.okpd2_codes) FROM jsonb_to_recordset($1::jsonb) AS x(okpd2_codes jsonb) ON CONFLICT DO NOTHING`, [json]);
  await client.query(`INSERT INTO technical_regulations(code) SELECT DISTINCT jsonb_array_elements_text(x.regulations) FROM jsonb_to_recordset($1::jsonb) AS x(regulations jsonb) ON CONFLICT DO NOTHING`, [json]);
  await client.query(`
    INSERT INTO document_tnved(document_id, code)
    SELECT d.id, parsed.code FROM jsonb_to_recordset($1::jsonb) AS x(source_type text, source_id bigint, tnved_codes jsonb)
    JOIN documents d ON d.source_type = x.source_type::source_type AND d.source_id = x.source_id
    CROSS JOIN LATERAL jsonb_array_elements_text(x.tnved_codes) AS parsed(code) ON CONFLICT DO NOTHING`, [json]);
  await client.query(`
    INSERT INTO document_okpd2(document_id, code)
    SELECT d.id, parsed.code FROM jsonb_to_recordset($1::jsonb) AS x(source_type text, source_id bigint, okpd2_codes jsonb)
    JOIN documents d ON d.source_type = x.source_type::source_type AND d.source_id = x.source_id
    CROSS JOIN LATERAL jsonb_array_elements_text(x.okpd2_codes) AS parsed(code) ON CONFLICT DO NOTHING`, [json]);
  await client.query(`
    INSERT INTO document_regulations(document_id, code, raw_text)
    SELECT d.id, parsed.code, x.regulations_raw FROM jsonb_to_recordset($1::jsonb) AS x(source_type text, source_id bigint, regulations jsonb, regulations_raw text)
    JOIN documents d ON d.source_type = x.source_type::source_type AND d.source_id = x.source_id
    CROSS JOIN LATERAL jsonb_array_elements_text(x.regulations) AS parsed(code) ON CONFLICT DO NOTHING`, [json]);
  await client.query(`
    INSERT INTO product_groups(type, value_raw, value_normalized)
    SELECT DISTINCT (gi.value->>'type')::product_group_type, gi.value->>'raw', gi.value->>'normalized'
    FROM jsonb_to_recordset($1::jsonb) AS x(product_groups jsonb)
    CROSS JOIN LATERAL jsonb_array_elements(x.product_groups) AS gi(value)
    ON CONFLICT (type, value_normalized) DO NOTHING`, [json]);
  await client.query(`
    INSERT INTO document_product_groups(document_id, product_group_id)
    SELECT d.id, pg.id FROM jsonb_to_recordset($1::jsonb) AS x(source_type text, source_id bigint, product_groups jsonb)
    JOIN documents d ON d.source_type = x.source_type::source_type AND d.source_id = x.source_id
    CROSS JOIN LATERAL jsonb_array_elements(x.product_groups) AS gi(value)
    JOIN product_groups pg ON pg.type = (gi.value->>'type')::product_group_type AND pg.value_normalized = gi.value->>'normalized'
    ON CONFLICT DO NOTHING`, [json]);
}

async function updateJob(client: PoolClient, table: string, values: { lastId?: number; processed?: number; failed?: number; status: 'running' | 'completed' | 'failed' }): Promise<void> {
  await client.query(`INSERT INTO normalization_jobs(source_table, last_processed_id, processed_count, failed_count, started_at, updated_at, status)
    VALUES ($1, $2, $3, $4, now(), now(), $5)
    ON CONFLICT (source_table) DO UPDATE SET last_processed_id = EXCLUDED.last_processed_id, processed_count = EXCLUDED.processed_count, failed_count = EXCLUDED.failed_count, updated_at = now(), status = EXCLUDED.status`, [table, values.lastId ?? 0, values.processed ?? 0, values.failed ?? 0, values.status]);
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  if (!Number.isSafeInteger(options.batchSize) || options.batchSize < 1 || options.batchSize > 10000) throw new Error('--batch-size must be 1..10000');
  const { table, sourceType } = sourceInfo(options.source);
  const rawUrl = process.env.RAW_MYSQL_URL;
  if (!rawUrl) throw new Error('RAW_MYSQL_URL is required. Copy .env.example to .env.');
  const mysqlPool = mysql.createPool({ uri: rawUrl, connectionLimit: 2, charset: 'utf8mb4' });
  const jobResult = await postgres.query<{ last_processed_id: string; processed_count: string; failed_count: string }>('SELECT last_processed_id, processed_count, failed_count FROM normalization_jobs WHERE source_table = $1', [table]);
  const prior = jobResult.rows[0];
  let cursor = options.fromId !== undefined ? options.fromId - 1 : (options.reset ? 0 : Number(prior?.last_processed_id ?? 0));
  let processed = options.reset || options.fromId !== undefined ? 0 : Number(prior?.processed_count ?? 0);
  let failed = Number(prior?.failed_count ?? 0);
  let remaining = options.limit ?? Number.MAX_SAFE_INTEGER;
  await withTransaction((client) => updateJob(client, table, { lastId: cursor, processed, failed, status: 'running' }));
  console.log(`Normalizing ${table} from id > ${cursor}; batch size ${options.batchSize}${options.limit ? `; limit ${options.limit}` : ''}`);
  try {
    while (remaining > 0) {
      const take = Math.min(options.batchSize, remaining);
      const [mysqlRows] = await mysqlPool.query(`SELECT ${selectFields(options.source)} FROM \`${table}\` WHERE id > ? ${options.toId !== undefined ? 'AND id <= ?' : ''} ORDER BY id LIMIT ?`, options.toId !== undefined ? [cursor, options.toId, take] : [cursor, take]);
      const rows = mysqlRows as RawDocumentRow[];
      if (rows.length === 0) break;
      const normalized = rows.map((row) => normalizeDocument(sourceType, row));
      const lastId = normalized.at(-1)!.sourceId;
      await withTransaction(async (client) => { await persistBatch(client, normalized); await updateJob(client, table, { lastId, processed: processed + normalized.length, failed, status: 'running' }); });
      cursor = lastId;
      processed += normalized.length;
      remaining -= normalized.length;
      console.log(`${table}: ${processed} records processed; checkpoint id ${cursor}`);
    }
    await withTransaction((client) => updateJob(client, table, { lastId: cursor, processed, failed, status: 'completed' }));
    console.log(`${table}: completed at id ${cursor}; ${processed} records in this checkpoint.`);
  } catch (error) {
    failed += 1;
    await withTransaction((client) => updateJob(client, table, { lastId: cursor, processed, failed, status: 'failed' }));
    throw error;
  } finally { await mysqlPool.end(); await postgres.end(); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
