export type SourceType = 'declaration' | 'certificate';

export interface RawDocumentRow {
  id: number;
  created_at: string | null;
  updated_at: string | null;
  status: string | null;
  number: string | null;
  dateBegin: string | null;
  dateEnd: string | null;
  declType?: string | null;
  certType?: string | null;
  technicalReglaments: string | null;
  productOrig: string | null;
  productFullName: string | null;
  productTnved: string | null;
  productOkpd2: string | null;
  groupEaes: string | null;
  groupRu: string | null;
  singleListEEU: string | null;
  singleListRU: string | null;
  strana: string | null;
}

export interface NormalizedDocument {
  sourceType: SourceType;
  sourceId: number;
  documentNumber: string | null;
  documentTypeRaw: string | null;
  documentTypeNormalized: string | null;
  statusRaw: string | null;
  statusNormalized: string | null;
  dateBegin: string | null;
  dateEnd: string | null;
  productNameRaw: string | null;
  productNameNormalized: string | null;
  productOriginRaw: string | null;
  productOriginNormalized: string | null;
  country: string | null;
  sourceCreatedAt: string | null;
  sourceUpdatedAt: string | null;
  tnvedCodes: string[];
  okpd2Codes: string[];
  regulations: string[];
  regulationsRaw: string | null;
  productGroups: Array<{ type: 'EAES_GROUP' | 'RU_GROUP' | 'EAES_SINGLE_LIST' | 'RU_SINGLE_LIST'; raw: string; normalized: string }>;
}

