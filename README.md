# Sertiki data layer

An independent data foundation for Sertiki:

```text
RAW MySQL ilovefsa (read-only) → deterministic Node.js normalizer → PostgreSQL → read-only REST API
```

The repository intentionally contains no direct integration with the existing DIAFAN site, MCP, LLM processing, embeddings, vector storage, or automated product catalogue generation. The current site work uses its normalized facts to form reviewed service categories and page mappings; it does not call this API from every page request.

## Source dump inventory

The untouched source dumps are in `backups/`:

| File | Compressed size | Contents |
| --- | ---: | --- |
| `00_schema.sql.gz` | 6.9 KB | ilovefsa schema |
| `01_small_tables.sql.gz` | 1.2 MB | reference/small tables |
| `10_certificate.sql.gz` | 626 MB | `pf_certificate` |
| `11_declaration.sql.gz` | 1.8 GB | `pf_declaration` |

The schema confirms both `pf_certificate` and `pf_declaration` have the fields used here, including `declType`/`certType`, classifiers, all four group fields, timestamps, and `strana`. Dumps are never altered by project scripts.

## Prerequisites

- Docker Desktop / Docker Compose
- Node.js 20+ and pnpm 10+

## Local workflow

1. Install Node dependencies and create local credentials:

   ```bash
   pnpm install
   cp .env.example .env
   # edit .env: never commit it
   ```

2. Start both databases:

   ```bash
   pnpm db:up
   ```

   MySQL is on `localhost:3307`; PostgreSQL is on `localhost:5433`. MySQL uses 5.7.44, `linux/amd64` for Apple Silicon compatibility, `utf8mb4_general_ci`, and `NO_ENGINE_SUBSTITUTION`.

3. Restore and normalize RAW sources one at a time. This is the default compact workflow and avoids keeping both large source tables in MySQL:

   ```bash
   pnpm raw:bootstrap
   pnpm raw:restore:certificates
   pnpm normalize:certificates
   pnpm raw:purge-source --source certificates --confirm

   pnpm raw:restore:declarations
   pnpm normalize:declarations
   pnpm raw:purge-source --source declarations --confirm
   ```

   The source dump remains untouched in `backups/`. The purge command drops only the RAW table after its successful normalization, freeing the MySQL volume before the next import. `pnpm raw:restore:all` retains both tables and is only for machines with ample disk space. The normalizer account has read-only MySQL access.

4. Create the Sertiki PostgreSQL schema:

   ```bash
   pnpm pg:migrate
   ```

5. Run safe test passes. These commands do **not** trigger a full import:

   ```bash
   pnpm normalize:declarations --limit 10000
   pnpm normalize:certificates --limit 10000
   ```

   Optional controls: `--batch-size 5000`, `--from-id 50000`, `--to-id 60000`, and `--reset`. Batches always use `WHERE id > last_processed_id ORDER BY id LIMIT batch_size`; no `OFFSET` is used. `normalization_jobs` checkpoints only after a PostgreSQL batch transaction succeeds, so a repeated command resumes safely. `--reset` starts its checkpoint at zero and upserts the same deterministic output.

6. Inspect quality-control statistics:

   ```bash
   pnpm stats
   ```

7. Start the API and query it:

   ```bash
   pnpm api
   curl http://localhost:3000/health
   curl http://localhost:3000/api/v1/documents/declaration/123
   curl --get --data-urlencode 'q=хлеб' http://localhost:3000/api/v1/products/search
   curl http://localhost:3000/api/v1/tnved/2716000000
   curl http://localhost:3000/api/v1/okpd2/35.11.10.110
   curl 'http://localhost:3000/api/v1/regulations/%D0%A2%D0%A0%20%D0%A2%D0%A1%20004%2F2011'
   ```

## PostgreSQL model

`documents` is the common declaration/certificate model, uniquely identified by `(source_type, source_id)`. In the default compact mode (`NORMALIZER_RETAIN_RAW=0`), PostgreSQL stores normalized fields, the source ID, document number, dates and classifiers; duplicate raw source strings remain only in the immutable `.sql.gz` archives. Set `NORMALIZER_RETAIN_RAW=1` only for a separate investigation that needs those copies. `tnved_codes`, `okpd2_codes`, `technical_regulations`, and `product_groups` are dictionaries; junction tables preserve their many-to-many relationships. Product group values retain their independent kinds: `EAES_GROUP`, `RU_GROUP`, `EAES_SINGLE_LIST`, and `RU_SINGLE_LIST`.

`catalog_products` and `catalog_product_documents` are prepared but deliberately left empty: creating a product catalogue requires a separate, reviewed product-matching policy.

## Normalization guarantees

- The RAW database is never updated, deleted from, or altered by the normalizer.
- `NULL` remains `NULL`; normalized text has control characters removed, whitespace folded, and edges trimmed without changing the corresponding raw source column.
- `0000-00-00` and `0000-00-00 00:00:00` become PostgreSQL `NULL`.
- Classifier extraction is conservative: codes are extracted from TN VED/OKPD2/regulation strings while the complete source text remains in the document model (and regulation relation raw text).
- PostgreSQL writes occur in set-based, JSON-recordset batch queries rather than one ORM insert per source row.

## Validation

```bash
pnpm test
pnpm typecheck
```

Unit fixtures cover product-name cleanup, splitting, TN VED, OKPD2, technical-regulation parsing, and zero dates.

## Future API deployment

The REST API and its `docker-compose.server.yml` are a future extension and are not deployed as part of the current AI-friendly site work. The existing Sertiki site runs on DIAFAN.CMS on Timeweb shared hosting, where the page card and JSON-LD use locally imported, reviewed mappings.

For a future production API, run the RAW restore and normalizer on a private import machine or in a separate private Compose project. RAW MySQL must remain private; do not expose port 3306/3307 or run the full normalizer during API startup.
