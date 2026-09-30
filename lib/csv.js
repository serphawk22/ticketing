/**
 * CSV helpers for the list view's import and export.
 *
 * Both directions are deliberately dependency free: the app ships no CSV
 * library, and the grammar we need is small (RFC 4180 quoting, embedded
 * newlines, escaped quotes) and stable enough to own.
 */

/** Quote a single value for a CSV cell, doubling any embedded quotes. */
export function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  // A leading =, +, - or @ makes spreadsheet apps treat the cell as a formula,
  // so those get quoted the way Jira's exporter does.
  const needsQuotes = /["\n\r,]/.test(text) || /^[=+\-@\t\r]/.test(text);
  return needsQuotes ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Build a whole CSV document from a header row and row objects. */
export function buildCsv(columns, rows) {
  const lines = [columns.map((c) => csvCell(c.label)).join(',')];
  for (const row of rows) {
    lines.push(columns.map((c) => csvCell(c.get ? c.get(row) : row[c.key])).join(','));
  }
  // A BOM makes Excel read the file as UTF-8 instead of the local code page.
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

/**
 * Trigger a browser download for generated CSV text.
 *
 * The object URL is revoked on the next tick: revoking synchronously can race
 * the download in some browsers, before the click has been handled.
 */
export function downloadCsv(filename, text) {
  if (typeof document === 'undefined') return;
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Split one CSV line into cells, honouring quotes and doubled quotes. */
function splitLine(line) {
  const cells = [];
  let current = '';
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      cells.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells;
}

/**
 * Parse CSV text into `{ headers, rows }` where every row is an object keyed by
 * the trimmed, lower-cased header. Rows whose cells are all blank are dropped,
 * so a trailing newline does not turn into an empty record.
 */
export function parseCsv(text) {
  const clean = String(text ?? '').replace(/^\uFEFF/, '');
  if (!clean.trim()) return { headers: [], rows: [] };

  // A quoted cell may contain a newline, so lines cannot simply be split first.
  const records = [];
  let current = [];
  let field = '';
  let quoted = false;

  const pushField = () => {
    current.push(field);
    field = '';
  };
  const pushRecord = () => {
    pushField();
    records.push(current);
    current = [];
  };

  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      pushField();
    } else if (ch === '\n') {
      pushRecord();
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  if (field !== '' || current.length > 0) pushRecord();

  const nonEmpty = records.filter((r) => r.some((cell) => cell.trim() !== ''));
  if (nonEmpty.length === 0) return { headers: [], rows: [] };

  const headers = nonEmpty[0].map((h) => h.trim().toLowerCase());
  const rows = nonEmpty.slice(1).map((cells) => {
    const row = {};
    headers.forEach((h, i) => {
      row[h] = (cells[i] ?? '').trim();
    });
    return row;
  });

  return { headers, rows };
}
