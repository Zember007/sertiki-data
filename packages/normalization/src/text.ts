/** Keeps source values intact; use only for the paired normalized columns. */
export function normalizeText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const normalized = value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/[\r\n\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized === '' ? null : normalized;
}

export function toNullableDate(value: string | null | undefined): string | null {
  if (value == null || /^0000-00-00(?: 00:00:00)?$/.test(value)) return null;
  return value;
}

/** Separator-only split: it never invents a product/classifier value. */
export function splitMultipleValues(value: string | null | undefined): string[] {
  if (value == null) return [];
  return value
    .split(/[;|\r\n]+/)
    .map((part) => normalizeText(part))
    .filter((part): part is string => part !== null);
}

