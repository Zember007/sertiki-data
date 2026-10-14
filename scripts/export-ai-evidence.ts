import 'dotenv/config';
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { postgres } from '../packages/database/src/client.js';

type CmsRecord = {
  source_module: string;
  source_id: number;
  url: string;
  title: string;
  candidate_score: number;
};
type Inventory = { records: CmsRecord[] };

const STOP_WORDS = new Set([
  'сертификат', 'сертификаты', 'сертификация', 'декларация', 'декларирование',
  'соответствия', 'соответствие', 'на', 'для', 'по', 'и', 'в', 'из', 'к',
  'оформление', 'получить', 'нужен', 'нужна', 'нужно', 'требования', 'тр', 'тс', 'еаэс',
]);

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function pageKind(record: CmsRecord): string {
  const title = (record.title ?? '').trim().toLowerCase();
  if (/^(?:сертификац\w*|сертификат\w*)\s+в\s+/u.test(title)) return 'geography';
  if (title.includes('реестр')) return 'registry';
  if (title.includes('контакт')) return 'contact';
  if (title.includes('вопрос') || title.includes('faq')) return 'faq';
  if (/(?:сертификат\w*|декларац\w*|сертификац\w*)\s+(?:на|для)\s+/u.test(title)) return 'service_candidate';
  if (record.source_module === 'site' && /(сертифик|декларац|соответств)/u.test(title)) return 'service_candidate';
  return record.source_module === 'clauses' ? 'article' : 'web_page';
}

function queryFromTitle(title: string): string {
  const words = title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').split(/\s+/u);
  return words.filter((word) => word.length > 2 && !STOP_WORDS.has(word)).slice(0, 6).join(' ');
}

function csv(value: unknown): string {
  const text = String(value ?? '');
  return /[;"\r\n]/u.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

async function evidenceFor(query: string): Promise<Record<string, string | number>> {
  const documents = await postgres.query<{
    id: string; source_type: string; source_id: string; document_type_normalized: string | null;
  }>(`
    SELECT id, source_type::text, source_id, document_type_normalized
    FROM documents
    WHERE to_tsvector('russian', coalesce(product_name_normalized, '')) @@ plainto_tsquery('russian', $1)
    LIMIT 50`, [query]);

  if (!documents.rowCount) {
    return { document_count: 0, document_types: '', technical_regulations: '', tnved_codes: '', okpd2_codes: '', product_groups: '', sample_document_refs: '' };
  }

  const ids = documents.rows.map((row) => Number(row.id));
  const classifications = await postgres.query<{
    technical_regulations: string; tnved_codes: string; okpd2_codes: string; product_groups: string;
  }>(`
    SELECT
      coalesce((SELECT string_agg(DISTINCT dr.code, '; ' ORDER BY dr.code) FROM document_regulations dr WHERE dr.document_id = ANY($1::bigint[])), '') AS technical_regulations,
      coalesce((SELECT string_agg(DISTINCT dt.code, '; ' ORDER BY dt.code) FROM document_tnved dt WHERE dt.document_id = ANY($1::bigint[])), '') AS tnved_codes,
      coalesce((SELECT string_agg(DISTINCT dok.code, '; ' ORDER BY dok.code) FROM document_okpd2 dok WHERE dok.document_id = ANY($1::bigint[])), '') AS okpd2_codes,
      coalesce((SELECT string_agg(DISTINCT pg.value_normalized, '; ' ORDER BY pg.value_normalized) FROM document_product_groups dpg JOIN product_groups pg ON pg.id = dpg.product_group_id WHERE dpg.document_id = ANY($1::bigint[])), '') AS product_groups`, [ids]);

  const typeCounts = new Map<string, number>();
  for (const row of documents.rows) {
    const type = row.document_type_normalized?.trim() || 'не указан';
    typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
  }
  const documentTypes = [...typeCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ru'))
    .map(([type, count]) => `${type} (${count})`).join('; ');
  const data = classifications.rows[0];
  return {
    document_count: documents.rowCount,
    document_types: documentTypes,
    technical_regulations: data.technical_regulations,
    tnved_codes: data.tnved_codes,
    okpd2_codes: data.okpd2_codes,
    product_groups: data.product_groups,
    sample_document_refs: documents.rows.slice(0, 10).map((row) => `${row.source_type}:${row.source_id}`).join(', '),
  };
}

async function main(): Promise<void> {
  const input = argument('--input');
  const output = argument('--output');
  if (!input || !output) throw new Error('Usage: pnpm tsx scripts/export-ai-evidence.ts --input <cms_inventory.json> --output <evidence.csv>');

  const jobs = await postgres.query<{ source_table: string; processed_count: string; status: string }>(
    `SELECT source_table, processed_count::text, status::text
     FROM normalization_jobs
     WHERE source_table IN ('pf_certificate', 'pf_declaration')`,
  );
  const completed = new Map(jobs.rows.map((job) => [job.source_table, job]));
  const missing = ['pf_certificate', 'pf_declaration'].filter((source) => {
    const job = completed.get(source);
    return !job || job.status !== 'completed' || Number(job.processed_count) === 0;
  });
  if (missing.length) {
    throw new Error(`Both sources must finish normalizing before exporting evidence. Incomplete: ${missing.join(', ')}`);
  }

  const documentCount = await postgres.query<{ count: string }>('SELECT count(*)::text AS count FROM documents');
  if (Number(documentCount.rows[0]?.count ?? 0) === 0) {
    throw new Error('The normalized PostgreSQL layer is empty. Complete RAW restore and both normalization runs before exporting evidence.');
  }

  const inventory = JSON.parse(await readFile(input, 'utf8')) as Inventory;
  const candidates = inventory.records.filter((record) => pageKind(record) === 'service_candidate');
  const header = ['source_module', 'source_id', 'url', 'title', 'query_text', 'document_count', 'document_types', 'technical_regulations', 'tnved_codes', 'okpd2_codes', 'product_groups', 'sample_document_refs', 'status'];
  const lines = [header.join(';')];
  const finalOutput = path.resolve(output);
  const partialOutput = `${finalOutput}.partial`;
  console.log(`Preparing evidence for ${candidates.length} service pages.`);

  for (const [index, record] of candidates.entries()) {
    const query = queryFromTitle(record.title);
    const evidence = query ? await evidenceFor(query) : await Promise.resolve({ document_count: 0, document_types: '', technical_regulations: '', tnved_codes: '', okpd2_codes: '', product_groups: '', sample_document_refs: '' });
    const values = [record.source_module, record.source_id, record.url, record.title, query, evidence.document_count, evidence.document_types, evidence.technical_regulations, evidence.tnved_codes, evidence.okpd2_codes, evidence.product_groups, evidence.sample_document_refs, 'needs_review'];
    lines.push(values.map(csv).join(';'));

    const processed = index + 1;
    if (processed % 25 === 0 || processed === candidates.length) {
      await writeFile(partialOutput, lines.join('\n') + '\n', 'utf8');
      console.log(`Prepared ${processed}/${candidates.length} evidence rows.`);
    }
  }
  await rename(partialOutput, finalOutput);
  console.log(`Wrote ${candidates.length} evidence rows to ${finalOutput}. All rows require legal and price review before publication.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { await postgres.end(); });
