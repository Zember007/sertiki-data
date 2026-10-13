-- Russian morphology is needed for matching a page title such as
-- "сертификат на молочную продукцию" with registry rows containing
-- "молочная продукция". This index is only for the private PostgreSQL layer.
CREATE INDEX IF NOT EXISTS documents_product_name_russian_search_idx
  ON documents USING gin (to_tsvector('russian', coalesce(product_name_normalized, '')));
