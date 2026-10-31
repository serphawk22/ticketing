'use client';

/**
 * Draws the task sheet rows currently on screen directly onto a canvas and
 * downloads the result as a PNG, the same way downloadHappySheetPng does for
 * the happy sheet. Pure canvas work, so nothing taints the bitmap (an SVG
 * <foreignObject> approach taints the canvas in Chrome and toBlob then throws).
 * Text columns are wrapped by hand to keep the image as close to the on-screen
 * table as possible.
 */

const FAMILY =
  "-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";

const COLORS = {
  ink: '#101828',
  muted: '#667085',
  faint: '#98a2b3',
  accent: '#0c64dc',
  headerBg: '#f2f4f7',
  headerText: '#475467',
  rowAlt: '#fcfcfd',
  grid: '#eef0f4',
  card: '#ffffff',
  danger: '#ae2e24',
  link: '#0c66e4',
};

const STATE = {
  completed: { label: 'Completed', text: '#1f8a3d', bg: '#d4f7dc' },
  not_completed: { label: 'Not Completed', text: '#626f86', bg: '#eef0f4' },
};

function wrapText(ctx, text, maxWidth, size, weight) {
  ctx.font = `${weight} ${size}px ${FAMILY}`;
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];
  const lines = [];
  let cur = '';
  for (const word of words) {
    const trial = cur ? `${cur} ${word}` : word;
    if (ctx.measureText(trial).width <= maxWidth || !cur) {
      cur = trial;
    } else {
      lines.push(cur);
      cur = word;
    }
  }
  lines.push(cur);
  return lines;
}

function formatDate(created_at) {
  const text = String(created_at ?? '');
  const iso = !text.includes('T') && text.includes(' ')
    ? `${text.replace(' ', 'T')}Z`
    : text;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return text;
  // Locale and time zone are pinned to match the table on screen, which uses
  // the same UTC + en-US pair.
  return d.toLocaleDateString('en-US', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function scopeLabel(filters = {}) {
  const parts = [];
  if (filters.name) parts.push(filters.name);
  if (filters.project) parts.push(filters.project);
  if (filters.from || filters.to) {
    parts.push(`${filters.from || '\u2026'} \u2192 ${filters.to || '\u2026'}`);
  }
  return parts.length ? parts.join(' \u00b7 ') : 'All time';
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, h / 2, w / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

export default function downloadTaskSheetPng(rows, { filters = {} } = {}) {
  const list = (rows || []).filter(Boolean);
  if (list.length === 0) return;

  const W = 1180;
  const scale = 2;
  const margin = 26;
  const tableW = W - margin * 2;
  const cols = [
    { key: 'date', label: 'Date', width: 100 },
    { key: 'name', label: 'Name', width: 140 },
    { key: 'project', label: 'Projects', width: 160 },
    { key: 'hours', label: 'Hours', width: 60, align: 'right' },
    {
      key: 'task',
      label: 'Task',
      width: tableW - 100 - 140 - 130 - 60 - 130 - 110,
    },
    { key: 'state', label: 'State', width: 130 },
    { key: 'work', label: 'Work item', width: 110 },
  ];

  const bodySize = 13;
  const noteSize = 12;
  const linePad = 4;
  const cellPadY = 9;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const headerH = 32;
  const footerH = 40;
  const titleBlockH = 68;

  let height = margin + titleBlockH + headerH;

  const cells = list.map((r) => {
    let tickets = [];
    if (r.tickets_detail) {
      try {
        const parsed = typeof r.tickets_detail === 'string' ? JSON.parse(r.tickets_detail) : r.tickets_detail;
        if (Array.isArray(parsed) && parsed.length > 0) tickets = parsed;
      } catch {}
    }
    const link = tickets.length > 0
      ? tickets.map((t) => `#${t.key}`).join(', ')
      : (r.linked_ticket_id
          ? `#${(r.linked_key || 'TM').toUpperCase()}-${r.linked_ticket_id}`
          : '\u2014');
    const state =
      STATE[r.task_state] || {
        label: r.task_state || '',
        text: COLORS.muted,
        bg: '#eef0f4',
      };

    return cols.map((c) => {
      let segments;
      if (c.key === 'date') {
        segments = [{ text: formatDate(r.created_at), color: COLORS.ink, weight: '400', size: bodySize }];
      } else if (c.key === 'name') {
        segments = [{ text: r.name, color: COLORS.ink, weight: '600', size: bodySize }];
        if (r.submitted_by_name && r.submitted_by_name !== r.name) {
          segments.push({ text: `filed by ${r.submitted_by_name}`, color: COLORS.faint, weight: '400', size: noteSize });
        }
      } else if (c.key === 'project') {
        const projects = Array.isArray(r.projects) && r.projects.length > 0
          ? r.projects.join(', ')
          : r.project;
        segments = [{ text: projects || '\u2014', color: COLORS.muted, weight: '400', size: bodySize }];
      } else if (c.key === 'hours') {
        segments = [{ text: `${r.hours_worked}h`, color: COLORS.ink, weight: '600', size: bodySize }];
      } else if (c.key === 'task') {
        segments = [{ text: r.task_title, color: COLORS.ink, weight: '600', size: bodySize }];
        if (r.task_description) {
          segments.push({ text: r.task_description, color: COLORS.muted, weight: '400', size: noteSize });
        }
        if (tickets.length > 0) {
          tickets.forEach((t) => {
            const isDone = t.workState === 'completed';
            const st = isDone ? (t.taskStatus || 'Completed') : (t.taskStatus || 'Not Completed');
            segments.push({
              text: `\u2022 #${t.key}: ${t.title || ''} [${st}]`,
              color: COLORS.ink,
              weight: '500',
              size: noteSize,
            });
            if (!isDone && t.blocker) {
              segments.push({
                text: `   Blocked: ${t.blocker}`,
                color: COLORS.danger,
                weight: '400',
                size: noteSize,
              });
            }
          });
        } else if (r.blocker) {
          segments.push({ text: `Blocked by: ${r.blocker}`, color: COLORS.danger, weight: '400', size: noteSize });
        }
      } else if (c.key === 'state') {
        segments = [{ text: state.label, color: state.text, weight: '600', size: noteSize, pill: state.bg }];
      } else {
        segments = [{ text: link, color: (tickets.length > 0 || r.linked_ticket_id) ? COLORS.link : COLORS.faint, weight: '600', size: noteSize }];
      }

      const lines = [];
      for (const seg of segments) {
        const wrapped = wrapText(ctx, seg.text, c.width - 24, seg.size, seg.weight);
        wrapped.forEach((text, i) => {
          lines.push({
            text,
            color: seg.color,
            weight: seg.weight,
            size: seg.size,
            // The pill belongs to the whole label, so only the first line gets it.
            pill: i === 0 ? seg.pill : undefined,
          });
        });
      }
      return { lines, align: c.align };
    });
  });

  height += cells.reduce(
    (acc, row) =>
      acc +
      2 * cellPadY +
      Math.max(...row.map((cell) => cell.lines.reduce((a, l) => a + l.size + linePad, 0))),
    0
  );
  height += footerH + margin;

  canvas.width = W * scale;
  canvas.height = Math.max(1, Math.ceil(height)) * scale;
  ctx.scale(scale, scale);
  ctx.textBaseline = 'top';

  ctx.fillStyle = COLORS.card;
  ctx.fillRect(0, 0, W, height);

  let y = margin;

  ctx.fillStyle = COLORS.accent;
  ctx.fillRect(margin, y, tableW, 3);
  y += 14;

  ctx.font = `700 20px ${FAMILY}`;
  ctx.fillStyle = COLORS.ink;
  ctx.fillText('Task Sheet', margin, y + 2);
  y += 34;

  ctx.font = `400 13px ${FAMILY}`;
  ctx.fillStyle = COLORS.muted;
  ctx.fillText(
    `${scopeLabel(filters)} \u00b7 ${list.length} row${list.length === 1 ? '' : 's'}`,
    margin,
    y
  );
  y += 16;

  ctx.fillStyle = COLORS.headerBg;
  ctx.fillRect(margin, y, tableW, headerH);

  const headerX = [];
  let x = margin;
  for (let i = 0; i < cols.length; i++) {
    headerX.push(x);
    x += cols[i].width;
  }

  ctx.font = `600 11px ${FAMILY}`;
  ctx.fillStyle = COLORS.headerText;
  cols.forEach((c, i) => {
    const label = c.label.toUpperCase();
    const tx = c.align === 'right'
      ? headerX[i] + c.width - 12 - ctx.measureText(label).width
      : headerX[i] + 12;
    ctx.fillText(label, tx, y + 11);
  });
  y += headerH;

  cells.forEach((row, rowIndex) => {
    const rowH =
      2 * cellPadY +
      Math.max(...row.map((cell) => cell.lines.reduce((a, l) => a + l.size + linePad, 0)));

    if (rowIndex % 2 === 1) {
      ctx.fillStyle = COLORS.rowAlt;
      ctx.fillRect(margin, y, tableW, rowH);
    }

    row.forEach((cell, i) => {
      const colX = headerX[i];
      let lineY = y + cellPadY;
      for (const line of cell.lines) {
        ctx.font = `${line.weight} ${line.size}px ${FAMILY}`;
        const textW = ctx.measureText(line.text).width;
        const tx = cell.align === 'right'
          ? colX + cols[i].width - 12 - textW
          : colX + 12;

        if (line.pill) {
          ctx.fillStyle = line.pill;
          roundRect(ctx, tx - 8, lineY - 1, textW + 16, line.size + 8, (line.size + 8) / 2);
          ctx.fill();
        }

        ctx.fillStyle = line.color;
        ctx.fillText(line.text, tx, lineY);
        lineY += line.size + linePad;
      }
    });

    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(margin, y + rowH);
    ctx.lineTo(margin + tableW, y + rowH);
    ctx.stroke();

    y += rowH;
  });

  ctx.font = `400 11px ${FAMILY}`;
  ctx.fillStyle = COLORS.faint;
  const now = new Date();
  const stamp = now.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  ctx.fillText(`Generated ${stamp} \u00b7 Ticket Manager`, margin, y + footerH - 22);

  const when = filters.from || filters.to
    ? `${filters.from || 'start'}_${filters.to || 'end'}`
    : 'all';
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `task-sheet-${when.replace(/[^a-z0-9-]/gi, '_')}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'image/png');
}
