-- Evidence export reads classifications for a bounded set of documents.
-- These indexes make that lookup use document_id as the leading key.
CREATE INDEX IF NOT EXISTS document_regulations_document_id_idx
  ON document_regulations (document_id);
CREATE INDEX IF NOT EXISTS document_tnved_document_id_idx
  ON document_tnved (document_id);
CREATE INDEX IF NOT EXISTS document_okpd2_document_id_idx
  ON document_okpd2 (document_id);
CREATE INDEX IF NOT EXISTS document_product_groups_document_id_idx
  ON document_product_groups (document_id);
