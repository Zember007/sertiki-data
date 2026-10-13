import 'dotenv/config';
import { postgres } from '../packages/database/src/client.js';

async function main(): Promise<void> {
  const result = await postgres.query(`
    SELECT
      count(DISTINCT d.id)::bigint AS documents,
      count(DISTINCT d.id) FILTER (WHERE source_type = 'declaration')::bigint AS declarations,
      count(DISTINCT d.id) FILTER (WHERE source_type = 'certificate')::bigint AS certificates,
      count(DISTINCT dt.document_id)::bigint AS documents_with_tnved,
      count(DISTINCT dok.document_id)::bigint AS documents_with_okpd2,
      count(DISTINCT dr.document_id)::bigint AS documents_with_regulations,
      count(DISTINCT d.id) FILTER (WHERE product_name_normalized IS NULL OR btrim(product_name_normalized) = '')::bigint AS without_product_name,
      (SELECT count(*)::bigint FROM tnved_codes) AS unique_tnved,
      (SELECT count(*)::bigint FROM okpd2_codes) AS unique_okpd2,
      (SELECT count(*)::bigint FROM technical_regulations) AS unique_regulations
    FROM documents d
    LEFT JOIN document_tnved dt ON dt.document_id = d.id
    LEFT JOIN document_okpd2 dok ON dok.document_id = d.id
    LEFT JOIN document_regulations dr ON dr.document_id = d.id`);
  console.table(result.rows[0]);
  await postgres.end();
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
