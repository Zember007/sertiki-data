import type { NormalizedDocument, RawDocumentRow, SourceType } from '../../domain/src/types.js';
import { parseOkpd2, parseTechnicalRegulations, parseTnved } from './parsers.js';
import { normalizeText, splitMultipleValues, toNullableDate } from './text.js';

const groupFields = [
  ['EAES_GROUP', 'groupEaes'],
  ['RU_GROUP', 'groupRu'],
  ['EAES_SINGLE_LIST', 'singleListEEU'],
  ['RU_SINGLE_LIST', 'singleListRU'],
] as const;

export function normalizeDocument(sourceType: SourceType, row: RawDocumentRow): NormalizedDocument {
  const documentType = sourceType === 'declaration' ? row.declType : row.certType;
  const productGroups = groupFields.flatMap(([type, field]) =>
    splitMultipleValues(row[field]).map((raw) => ({ type, raw, normalized: raw })),
  );

  return {
    sourceType,
    sourceId: Number(row.id),
    documentNumber: row.number,
    documentTypeRaw: documentType ?? null,
    documentTypeNormalized: normalizeText(documentType),
    statusRaw: row.status,
    statusNormalized: normalizeText(row.status),
    dateBegin: toNullableDate(row.dateBegin),
    dateEnd: toNullableDate(row.dateEnd),
    productNameRaw: row.productFullName,
    productNameNormalized: normalizeText(row.productFullName),
    productOriginRaw: row.productOrig,
    productOriginNormalized: normalizeText(row.productOrig),
    country: normalizeText(row.strana),
    sourceCreatedAt: toNullableDate(row.created_at),
    sourceUpdatedAt: toNullableDate(row.updated_at),
    tnvedCodes: parseTnved(row.productTnved),
    okpd2Codes: parseOkpd2(row.productOkpd2),
    regulations: parseTechnicalRegulations(row.technicalReglaments),
    regulationsRaw: row.technicalReglaments,
    productGroups,
  };
}

