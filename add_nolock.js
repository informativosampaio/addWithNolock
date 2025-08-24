'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

// --- Configuration ---
// Edit ROOT_DIR to control where the scan will run. You can also override via env: TARGET_PATH or SCAN_ROOT
const ROOT_DIR = process.env.TARGET_PATH || process.env.SCAN_ROOT || path.resolve(process.cwd());
const INCLUDE_EXTENSIONS = new Set(['.aspx', '.aspx.vb']);
const IGNORE_DIRS = new Set(['.git', 'node_modules', 'bin', 'obj', '.vs', '.vscode', '.idea']);
const DEFAULT_VERBOSE = true;

// Helpers: case-insensitive test utilities
function indexOfRegex(regex, input, fromIndex = 0) {
  regex.lastIndex = fromIndex;
  const match = regex.exec(input);
  return match ? { index: match.index, match } : { index: -1, match: null };
}

function hasSelectNearby(text, pos) {
  const windowStart = Math.max(0, pos - 1500);
  const before = text.slice(windowStart, pos).toLowerCase();
  if (!/\bselect\b/.test(before)) return false;
  const near = text.slice(Math.max(0, pos - 40), pos).toLowerCase();
  if (/\bdelete\s+from\b/.test(near)) return false;
  // Avoid UPDATE ... FROM noise heuristically
  const before300 = before.slice(-300);
  if (/\bupdate\b/.test(before300)) return false;
  return true;
}

function isWhitespace(char) {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === '\f' || char === '\v';
}

function skipWhitespaceAndComments(text, idx) {
  let i = idx;
  while (i < text.length) {
    // whitespace
    while (i < text.length && isWhitespace(text[i])) i++;
    if (i >= text.length) break;
    // line comment -- ... (until end of line)
    if (text[i] === '-' && text[i + 1] === '-') {
      i += 2;
      while (i < text.length && text[i] !== '\n' && text[i] !== '\r') i++;
      continue;
    }
    // block comment /* ... */
    if (text[i] === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      if (i < text.length) i += 2; // consume */
      continue;
    }
    break;
  }
  return i;
}

function parseDelimitedIdentifier(text, idx) {
  // Parses one identifier part: [name] or "name" or `name` or unquoted token
  if (idx >= text.length) return { end: idx, ok: false };
  const start = idx;
  const ch = text[idx];
  if (ch === '[') {
    let i = idx + 1;
    while (i < text.length) {
      if (text[i] === ']' && text[i + 1] === ']') { // escaped ]]
        i += 2;
        continue;
      }
      if (text[i] === ']') { i++; break; }
      i++;
    }
    return { end: i, ok: true };
  }
  if (ch === '"') {
    let i = idx + 1;
    while (i < text.length) {
      if (text[i] === '"' && text[i + 1] === '"') { i += 2; continue; }
      if (text[i] === '"') { i++; break; }
      i++;
    }
    return { end: i, ok: true };
  }
  if (ch === '`') {
    let i = idx + 1;
    while (i < text.length) {
      if (text[i] === '`' && text[i + 1] === '`') { i += 2; continue; }
      if (text[i] === '`') { i++; break; }
      i++;
    }
    return { end: i, ok: true };
  }
  // unquoted: letters, numbers, _, #, $, @
  if (/[A-Za-z0-9_#$@]/.test(ch)) {
    let i = idx + 1;
    while (i < text.length && /[A-Za-z0-9_#$@\-]/.test(text[i])) i++;
    return { end: i, ok: true };
  }
  return { end: start, ok: false };
}

function parseTableSpec(text, idx) {
  // Parse multi-part identifier up to 4 parts: part(.part){0,3}
  let i = idx;
  let partCount = 0;
  while (partCount < 4) {
    i = skipWhitespaceAndComments(text, i);
    const part = parseDelimitedIdentifier(text, i);
    if (!part.ok) break;
    i = part.end;
    partCount++;
    const saveI = i;
    i = skipWhitespaceAndComments(text, i);
    if (text[i] === '.') {
      i++;
      continue;
    }
    // no dot: done
    i = saveI;
    break;
  }
  const ok = partCount > 0;
  return { end: i, ok };
}

function scanForWithBeforeDelimiters(text, idx) {
  // Scans forward from idx for an existing WITH( ... ) before hitting clause delimiters
  // Returns { found: boolean, withStart: number, withEnd: number }
  let i = idx;
  let parenDepth = 0;
  const isWordHere = (word) => text.slice(i, i + word.length).toLowerCase() === word.toLowerCase();
  while (i < text.length) {
    i = skipWhitespaceAndComments(text, i);
    if (i >= text.length) break;

    // delimiter characters or keywords indicating end of table source
    const nextToken = text.slice(i, i + 12).toLowerCase();
    if (text[i] === ',' || text[i] === ')') break;
    if (isWordHere('on ') || isWordHere('on\t') || isWordHere('where ') || isWordHere('group ') ||
        isWordHere('order ') || isWordHere('join ') || isWordHere('inner ') || isWordHere('left ') ||
        isWordHere('right ') || isWordHere('full ') || isWordHere('cross ') || isWordHere('union ') ||
        isWordHere('intersect ') || isWordHere('except ') || isWordHere('having ') || isWordHere('option ') ||
        isWordHere('for ')) {
      break;
    }

    // found WITH
    if (text.slice(i, i + 4).toLowerCase() === 'with') {
      let j = i + 4;
      j = skipWhitespaceAndComments(text, j);
      if (text[j] === '(') {
        // find matching ) respecting nested parentheses
        let k = j + 1;
        let depth = 1;
        while (k < text.length && depth > 0) {
          if (text[k] === '(') depth++;
          else if (text[k] === ')') depth--;
          k++;
        }
        return { found: true, withStart: i, withOpen: j, withClose: k - 1 };
      }
    }

    // advance token: if identifier or AS or alias, skip it
    const ident = parseDelimitedIdentifier(text, i);
    if (ident.ok) { i = ident.end; continue; }
    i++; // fallback advance
  }
  return { found: false };
}

function addNoLockInsideWithBlock(text, withOpen, withClose) {
  const inner = text.slice(withOpen + 1, withClose);
  if (/\bnolock\b/i.test(inner)) return text; // already present
  const trimmed = inner.trim();
  let replacement;
  if (trimmed.length === 0) replacement = 'NOLOCK';
  else if (/[,)]\s*$/.test(inner)) replacement = inner.replace(/\s*$/,'') + ' NOLOCK';
  else replacement = inner.replace(/\s*$/,'') + ', NOLOCK';
  return text.slice(0, withOpen + 1) + replacement + text.slice(withClose);
}

function transformSqlInText(inputText) {
  let text = inputText;
  let hintsAdded = 0;
  let hintsMerged = 0;

  // Pass 1: ensure existing WITH(...) near SELECT have NOLOCK
  {
    const regex = /with\s*\(/ig;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const idx = match.index;
      if (!hasSelectNearby(text, idx)) continue;
      // find close paren
      let j = skipWhitespaceAndComments(text, idx + match[0].length - 1); // at '(' or later
      // ensure we are at '(' immediately after optional spaces
      j = idx + match[0].length - 1; // this should be the '('
      if (text[j] !== '(') continue;
      let k = j + 1;
      let depth = 1;
      while (k < text.length && depth > 0) {
        if (text[k] === '(') depth++;
        else if (text[k] === ')') depth--;
        k++;
      }
      const withOpen = j;
      const withClose = k - 1;
      const beforeChange = text;
      text = addNoLockInsideWithBlock(text, withOpen, withClose);
      if (text !== beforeChange) hintsMerged++;
      // Move regex lastIndex accordingly to avoid infinite loop due to string length changes
      regex.lastIndex = k; // continue after the block
    }
  }

  // Pass 2: add WITH (NOLOCK) after table spec if not present before delimiters
  const fromJoinRegex = /\b(from|inner\s+join|left\s+(?:outer\s+)?join|right\s+(?:outer\s+)?join|full\s+(?:outer\s+)?join|cross\s+join|join)\b/ig;
  let m;
  while ((m = fromJoinRegex.exec(text)) !== null) {
    const kwStart = m.index;
    const kwEnd = kwStart + m[0].length;

    if (!hasSelectNearby(text, kwStart)) continue;

    let i = kwEnd;
    i = skipWhitespaceAndComments(text, i);
    if (text[i] === '(') continue; // derived table

    // parse table identifier
    const table = parseTableSpec(text, i);
    if (!table.ok) continue;
    const tableEnd = table.end;

    // check if WITH exists before delimiters; if yes, ensure it has NOLOCK (already covered pass1), else insert
    const scan = scanForWithBeforeDelimiters(text, tableEnd);
    if (scan.found) {
      // In rare cases NOLOCK may not be present if WITH came after alias and pass1 didn't catch; ensure merge now
      const before = text;
      text = addNoLockInsideWithBlock(text, scan.withOpen, scan.withClose);
      if (text !== before) hintsMerged++;
      continue;
    }

    // Insert WITH (NOLOCK) immediately after table name, before alias
    const insertion = ' WITH (NOLOCK)';
    text = text.slice(0, tableEnd) + insertion + text.slice(tableEnd);
    hintsAdded++;

    // Adjust lastIndex due to insertion
    fromJoinRegex.lastIndex = tableEnd + insertion.length;
  }

  return { text, stats: { hintsAdded, hintsMerged } };
}

async function readFilePreserveBOM(filePath) {
  const buf = await fsp.readFile(filePath);
  const hasBOM = buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF;
  const content = hasBOM ? buf.slice(3).toString('utf8') : buf.toString('utf8');
  return { content, hasBOM };
}

async function writeFilePreserveBOM(filePath, content, hasBOM) {
  const data = (hasBOM ? '\uFEFF' : '') + content;
  await fsp.writeFile(filePath, data, 'utf8');
}

async function processSingleFile(filePath, verbose = DEFAULT_VERBOSE) {
  const { content, hasBOM } = await readFilePreserveBOM(filePath);
  const { text: newContent, stats } = transformSqlInText(content);
  const changed = newContent !== content;
  if (changed) {
    await writeFilePreserveBOM(filePath, newContent, hasBOM);
    if (verbose) {
      console.log(`Updated: ${filePath} (added: ${stats.hintsAdded}, merged: ${stats.hintsMerged})`);
    }
  }
  return { changed, stats };
}

async function processFilesInDirectory(rootDir, options = {}) {
  const {
    verbose = DEFAULT_VERBOSE,
    includeExtensions = INCLUDE_EXTENSIONS,
    ignoreDirs = IGNORE_DIRS
  } = options;

  let filesScanned = 0;
  let filesChanged = 0;
  let totalAdded = 0;
  let totalMerged = 0;

  async function walk(currentDir) {
    const dir = await fsp.opendir(currentDir);
    for await (const dirent of dir) {
      const entryPath = path.join(currentDir, dirent.name);
      if (dirent.isDirectory()) {
        if (ignoreDirs.has(dirent.name)) continue;
        await walk(entryPath);
      } else if (dirent.isFile()) {
        const lower = dirent.name.toLowerCase();
        const ext = lower.endsWith('.aspx.vb') ? '.aspx.vb' : path.extname(lower);
        if (includeExtensions.has(ext)) {
          filesScanned++;
          const { changed, stats } = await processSingleFile(entryPath, verbose);
          if (changed) filesChanged++;
          totalAdded += stats.hintsAdded;
          totalMerged += stats.hintsMerged;
        }
      }
    }
  }

  await walk(rootDir);
  return { filesScanned, filesChanged, totalAdded, totalMerged };
}

async function main() {
  const start = Date.now();
  console.log(`Node ${process.version} - Scanning for SELECT without WITH (NOLOCK)`);
  console.log(`Root: ${ROOT_DIR}`);
  const res = await processFilesInDirectory(ROOT_DIR, { verbose: true });
  const ms = Date.now() - start;
  console.log(`Done in ${ms} ms. Files scanned: ${res.filesScanned}. Files changed: ${res.filesChanged}. Added: ${res.totalAdded}. Merged: ${res.totalMerged}.`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

module.exports = {
  ROOT_DIR,
  transformSqlInText,
  processFilesInDirectory,
  processSingleFile
};