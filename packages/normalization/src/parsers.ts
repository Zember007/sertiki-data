import { normalizeText, splitMultipleValues } from './text.js';

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

/** Extracts 6–10 digit TN VED codes without fabricating punctuation or leading zeroes. */
export function parseTnved(value: string | null | undefined): string[] {
  if (value == null) return [];
  return unique((value.match(/(?<!\d)\d{6,10}(?!\d)/g) ?? []));
}

/** Extracts conventional dotted OKPD2 codes and undotted values when explicitly supplied. */
export function parseOkpd2(value: string | null | undefined): string[] {
  if (value == null) return [];
  const dotted = value.match(/(?<![\d.])\d{2}\.\d{2}(?:\.\d{1,3}){0,2}(?![\d.])/g) ?? [];
  const undotted = value.match(/(?<!\d)\d{6,12}(?!\d)/g) ?? [];
  return unique([...dotted, ...undotted]);
}

/** Recognises the code only; descriptions stay preserved in documents.regulations_raw. */
export function parseTechnicalRegulations(value: string | null | undefined): string[] {
  if (value == null) return [];
  const matches = value.match(/ТР\s*(?:ТС|ЕАЭС|РФ)\s*\d{3}\/\d{4}/giu) ?? [];
  return unique(matches.map((match) => normalizeText(match)?.toUpperCase() ?? '').filter(Boolean));
}

export { splitMultipleValues };

