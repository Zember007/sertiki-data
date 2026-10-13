CREATE TYPE source_type AS ENUM ('declaration', 'certificate');
CREATE TYPE product_group_type AS ENUM ('EAES_GROUP', 'RU_GROUP', 'EAES_SINGLE_LIST', 'RU_SINGLE_LIST');
CREATE TYPE normalization_job_status AS ENUM ('idle', 'running', 'completed', 'failed');

CREATE TABLE documents (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_type source_type NOT NULL,
  source_id BIGINT NOT NULL,
  document_number TEXT,
  document_type_raw TEXT,
  document_type_normalized TEXT,
  status_raw TEXT,
  status_normalized TEXT,
  date_begin DATE,
  date_end DATE,
  product_name_raw TEXT,
  product_name_normalized TEXT,
  product_origin_raw TEXT,
  product_origin_normalized TEXT,
  country TEXT,
  source_created_at TIMESTAMP,
  source_updated_at TIMESTAMP,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_type, source_id)
);
CREATE INDEX documents_source_number_idx ON documents (document_number);
CREATE INDEX documents_source_type_status_idx ON documents (source_type, status_normalized);
CREATE INDEX documents_product_name_search_idx ON documents USING gin (to_tsvector('simple', coalesce(product_name_normalized, '')));

CREATE TABLE tnved_codes (code TEXT PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE okpd2_codes (code TEXT PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE technical_regulations (
  code TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE product_groups (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  type product_group_type NOT NULL,
  value_raw TEXT NOT NULL,
  value_normalized TEXT NOT NULL,
  UNIQUE (type, value_normalized)
);

CREATE TABLE document_tnved (
  document_id BIGINT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  code TEXT NOT NULL REFERENCES tnved_codes(code),
  PRIMARY KEY (document_id, code)
);
CREATE INDEX document_tnved_code_idx ON document_tnved (code, document_id);
CREATE TABLE document_okpd2 (
  document_id BIGINT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  code TEXT NOT NULL REFERENCES okpd2_codes(code),
  PRIMARY KEY (document_id, code)
);
CREATE INDEX document_okpd2_code_idx ON document_okpd2 (code, document_id);
CREATE TABLE document_regulations (
  document_id BIGINT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  code TEXT NOT NULL REFERENCES technical_regulations(code),
  raw_text TEXT,
  PRIMARY KEY (document_id, code)
);
CREATE INDEX document_regulations_code_idx ON document_regulations (code, document_id);
CREATE TABLE document_product_groups (
  document_id BIGINT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  product_group_id BIGINT NOT NULL REFERENCES product_groups(id),
  PRIMARY KEY (document_id, product_group_id)
);

CREATE TABLE catalog_products (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL,
  name_normalized TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX catalog_products_name_search_idx ON catalog_products USING gin (to_tsvector('simple', name_normalized));
CREATE TABLE catalog_product_documents (
  catalog_product_id BIGINT NOT NULL REFERENCES catalog_products(id) ON DELETE CASCADE,
  document_id BIGINT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  PRIMARY KEY (catalog_product_id, document_id)
);

CREATE TABLE normalization_jobs (
  source_table TEXT PRIMARY KEY,
  last_processed_id BIGINT NOT NULL DEFAULT 0,
  processed_count BIGINT NOT NULL DEFAULT 0,
  failed_count BIGINT NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status normalization_job_status NOT NULL DEFAULT 'idle'
);

