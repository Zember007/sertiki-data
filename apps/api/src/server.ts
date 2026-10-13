import 'dotenv/config';
import Fastify from 'fastify';
import { postgres } from '../../../packages/database/src/client.js';

const app = Fastify({ logger: true });

app.get('/health', async () => {
  await postgres.query('SELECT 1');
  return { status: 'ok' };
});

app.get<{ Params: { sourceType: string; sourceId: string } }>('/api/v1/documents/:sourceType/:sourceId', async (request, reply) => {
  const { sourceType, sourceId } = request.params;
  if (!['declaration', 'certificate'].includes(sourceType) || !/^\d+$/.test(sourceId)) return reply.code(400).send({ error: 'sourceType must be declaration|certificate and sourceId must be an integer' });
  const result = await postgres.query(`
    SELECT d.*, coalesce((SELECT json_agg(code ORDER BY code) FROM document_tnved WHERE document_id = d.id), '[]') AS tnved_codes,
      coalesce((SELECT json_agg(code ORDER BY code) FROM document_okpd2 WHERE document_id = d.id), '[]') AS okpd2_codes,
      coalesce((SELECT json_agg(code ORDER BY code) FROM document_regulations WHERE document_id = d.id), '[]') AS regulations,
      coalesce((SELECT json_agg(json_build_object('type', pg.type, 'value', pg.value_normalized) ORDER BY pg.type, pg.value_normalized) FROM document_product_groups dpg JOIN product_groups pg ON pg.id = dpg.product_group_id WHERE dpg.document_id = d.id), '[]') AS product_groups
    FROM documents d WHERE d.source_type = $1::source_type AND d.source_id = $2`, [sourceType, sourceId]);
  if (!result.rowCount) return reply.code(404).send({ error: 'Document not found' });
  return result.rows[0];
});

app.get<{ Querystring: { q?: string; limit?: string } }>('/api/v1/products/search', async (request, reply) => {
  const q = request.query.q?.trim();
  if (!q) return reply.code(400).send({ error: 'q is required' });
  const parsedLimit = Number(request.query.limit ?? 20);
  const limit = Number.isSafeInteger(parsedLimit) ? Math.max(1, Math.min(parsedLimit, 100)) : 20;
  const result = await postgres.query(`SELECT source_type, source_id, document_number, coalesce(product_name_raw, product_name_normalized) AS product_name_raw, product_name_normalized, status_normalized
    FROM documents WHERE to_tsvector('simple', coalesce(product_name_normalized, '')) @@ plainto_tsquery('simple', $1)
      OR product_name_normalized ILIKE '%' || $1 || '%'
    ORDER BY source_updated_at DESC NULLS LAST, source_id DESC LIMIT $2`, [q, limit]);
  return { items: result.rows, limit };
});

async function classifierLookup(table: 'tnved_codes' | 'okpd2_codes' | 'technical_regulations', relation: 'document_tnved' | 'document_okpd2' | 'document_regulations', code: string) {
  const result = await postgres.query(`SELECT d.source_type, d.source_id, d.document_number, coalesce(d.product_name_raw, d.product_name_normalized) AS product_name_raw, d.status_normalized
    FROM ${relation} relation JOIN documents d ON d.id = relation.document_id WHERE relation.code = $1 ORDER BY d.source_updated_at DESC NULLS LAST, d.source_id DESC LIMIT 100`, [code]);
  return { code, documents: result.rows };
}
app.get<{ Params: { code: string } }>('/api/v1/tnved/:code', async (request) => classifierLookup('tnved_codes', 'document_tnved', request.params.code));
app.get<{ Params: { code: string } }>('/api/v1/okpd2/:code', async (request) => classifierLookup('okpd2_codes', 'document_okpd2', request.params.code));
app.get<{ Params: { code: string } }>('/api/v1/regulations/:code', async (request) => classifierLookup('technical_regulations', 'document_regulations', request.params.code));

const close = async () => { await app.close(); await postgres.end(); };
process.on('SIGINT', close); process.on('SIGTERM', close);
app.listen({ host: process.env.API_HOST ?? '0.0.0.0', port: Number(process.env.API_PORT ?? 3000) }).catch(async (error) => { app.log.error(error); await close(); process.exit(1); });

