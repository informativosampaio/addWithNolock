'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const { processFilesInDirectory } = require('../add_nolock.js');

async function withTempDir(fn) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'nolock-tests-'));
  try {
    return await fn(dir);
  } finally {
    // Clean up recursively
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

test('integration: modifies .aspx and .aspx.vb files and preserves others', async () => {
  await withTempDir(async (dir) => {
    const fileAspx = path.join(dir, 'page.aspx');
    const fileAspxVb = path.join(dir, 'code.aspx.vb');
    const fileOther = path.join(dir, 'ignore.txt');

    const contentAspx = [
      '<%@ Page Language="VB" %>',
      '<script runat="server">',
      '  Dim sql As String = "SELECT * FROM dbo.Users u INNER JOIN dbo.Roles r ON u.rid=r.id"',
      '</script>'
    ].join('\n');

    const contentAspxVb = [
      'Partial Class CodeBehind',
      '  Sub LoadData()',
      '    Dim cmd As String = "SELECT * FROM [dbo].[Orders] o WHERE o.Id = 1"',
      '  End Sub',
      'End Class'
    ].join('\r\n'); // simulate CRLF

    await fsp.writeFile(fileAspx, contentAspx, 'utf8');
    await fsp.writeFile(fileAspxVb, contentAspxVb, 'utf8');
    await fsp.writeFile(fileOther, 'SELECT * FROM dbo.ShouldNotChange', 'utf8');

    const res = await processFilesInDirectory(dir, { verbose: false });

    assert.equal(res.filesScanned, 2);
    assert.equal(res.filesChanged, 2);
    assert.ok(res.totalAdded >= 2);

    const outAspx = await fsp.readFile(fileAspx, 'utf8');
    assert.match(outAspx, /FROM\s+dbo\.Users\s+WITH\s*\(NOLOCK\)\s+u/i);
    assert.match(outAspx, /JOIN\s+dbo\.Roles\s+WITH\s*\(NOLOCK\)\s+r/i);

    const outAspxVb = await fsp.readFile(fileAspxVb, 'utf8');
    // CRLF preserved aside from inserted tokens
    assert.match(outAspxVb, /FROM\s+\[dbo\]\s*\.\s*\[Orders\]\s+WITH\s*\(NOLOCK\)\s+o/i);

    const outOther = await fsp.readFile(fileOther, 'utf8');
    assert.equal(outOther, 'SELECT * FROM dbo.ShouldNotChange');
  });
});