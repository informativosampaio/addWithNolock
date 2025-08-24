'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { transformSqlInText } = require('../add_nolock.js');

function normalizeSpaces(s) {
  return s.replace(/\s+/g, ' ').trim();
}

test('adds NOLOCK after FROM table name', () => {
  const input = 'SELECT * FROM dbo.Table t WHERE 1=1';
  const { text, stats } = transformSqlInText(input);
  assert.match(text, /FROM\s+dbo\.Table\s+WITH\s*\(NOLOCK\)\s+t/i);
  assert.equal(stats.hintsAdded, 1);
});

test('adds NOLOCK with bracketed names and AS alias', () => {
  const input = 'SELECT * FROM [dbo].[My Table] AS mt';
  const { text } = transformSqlInText(input);
  assert.match(text, /FROM\s+\[dbo\]\s*\.\s*\[My Table\]\s+WITH\s*\(NOLOCK\)\s+AS\s+mt/i);
});

test('does not change derived tables', () => {
  const input = 'SELECT * FROM (SELECT 1 AS x) d';
  const { text, stats } = transformSqlInText(input);
  assert.equal(text, input);
  assert.equal(stats.hintsAdded, 0);
});

test('merges NOLOCK into existing WITH hints', () => {
  const input = 'SELECT * FROM dbo.Table WITH (INDEX(1)) t';
  const { text, stats } = transformSqlInText(input);
  assert.match(text, /WITH\s*\(.*INDEX\(1\).*NOLOCK.*\)/i);
  assert.equal(stats.hintsMerged, 1);
});

test('leaves existing NOLOCK intact', () => {
  const input = 'SELECT * FROM dbo.Table WITH (NOLOCK) t';
  const { text, stats } = transformSqlInText(input);
  assert.equal(text, input);
  assert.equal(stats.hintsAdded + stats.hintsMerged, 0);
});

test('handles JOINs and adds NOLOCK for both tables', () => {
  const input = 'SELECT * FROM dbo.A a INNER JOIN dbo.B b ON a.id=b.id';
  const { text } = transformSqlInText(input);
  assert.match(text, /FROM\s+dbo\.A\s+WITH\s*\(NOLOCK\)\s+a\s+INNER\s+JOIN\s+dbo\.B\s+WITH\s*\(NOLOCK\)\s+b/i);
});

test('does not modify DELETE FROM statements', () => {
  const input = 'DELETE FROM dbo.Table WHERE id=1';
  const { text } = transformSqlInText(input);
  assert.equal(text, input);
});

test('does not modify UPDATE ... FROM join statements', () => {
  const input = 'UPDATE t SET col=1 FROM dbo.Table t WHERE id=1';
  const { text } = transformSqlInText(input);
  assert.equal(text, input);
});

test('CROSS JOIN gets NOLOCK', () => {
  const input = 'SELECT * FROM dbo.A a CROSS JOIN dbo.B b';
  const { text } = transformSqlInText(input);
  assert.match(text, /A\s+WITH\s*\(NOLOCK\).*CROSS\s+JOIN\s+dbo\.B\s+WITH\s*\(NOLOCK\)/i);
});

test('handles quoted identifiers', () => {
  const input = 'SELECT * FROM "dbo"."Table-Name" t';
  const { text } = transformSqlInText(input);
  assert.match(text, /FROM\s+"dbo"\s*\.\s*"Table-Name"\s+WITH\s*\(NOLOCK\)/i);
});

test('adds NOLOCK when WITH is after alias', () => {
  const input = 'SELECT * FROM dbo.Table t WITH (HOLDLOCK)';
  const { text } = transformSqlInText(input);
  assert.match(text, /WITH\s*\(.*HOLDLOCK.*NOLOCK.*\)/i);
});