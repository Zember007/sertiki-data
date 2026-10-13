import assert from 'node:assert/strict';
import test from 'node:test';
import { parseOkpd2, parseTechnicalRegulations, parseTnved, splitMultipleValues } from '../src/parsers.js';
import { normalizeText, toNullableDate } from '../src/text.js';
import { certificateFixture } from './fixtures.js';

test('product name normalization removes control characters and collapses whitespace', () => {
  assert.equal(normalizeText(certificateFixture.productName), 'Огнетушитель порошковый переносной ОП-1(з)-АВС');
  assert.equal(normalizeText(' \t '), null);
});
test('TNVED parser separates codes', () => assert.deepEqual(parseTnved(certificateFixture.tnved), ['8424100000', '2716000000']));
test('OKPD2 parser keeps dotted codes', () => assert.deepEqual(parseOkpd2(certificateFixture.okpd2), ['35.11.10.110', '10.51.40']));
test('technical regulation parser returns recognised codes only', () => assert.deepEqual(parseTechnicalRegulations(certificateFixture.regulations), ['ТР ТС 004/2011', 'ТР ЕАЭС 037/2016', 'ТР ТС 020/2011']));
test('MySQL zero dates become null', () => { assert.equal(toNullableDate('0000-00-00'), null); assert.equal(toNullableDate('0000-00-00 00:00:00'), null); assert.equal(toNullableDate('2020-01-02'), '2020-01-02'); });
test('multiple values split only at explicit separators', () => assert.deepEqual(splitMultipleValues('one; two\nthree | four'), ['one', 'two', 'three', 'four']));
