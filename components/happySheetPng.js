'use client';

/**
 * Draws the happy sheet rows currently on screen directly onto a canvas and
 * downloads the result as a PNG. Pure canvas work, so nothing taints it (an
 * SVG <foreignObject> approach taints the canvas in Chrome and toBlob then
 * throws). Text columns are wrapped by hand to keep the image as close to the
 * on-screen table as possible.
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
  if (Number.isNaN(d.getTime())) return { date: text, time: '' };
  return {
    date: d.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }),
    time: d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  };
}

function scopeLabel(day) {
  if (day) {
    const d = new Date(`${day}T00:00:00`);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString(undefined, {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    }
    return day;
  }
  return 'All time';
}

export default function downloadHappySheetPng(rows, { day = '' } = {}) {
  const list = (rows || []).filter(Boolean);
  if (list.length === 0) return;

  const W = 1180;
  const scale = 2;
  const margin = 26;
  const tableW = W - margin * 2;
  const cols = [
    { key: 'date', label: 'Date', width: 100 },
    { key: 'time', label: 'Time', width: 60 },
    { key: 'name', label: 'Name', width: 150 },
    {
      key: 'happy_one',
      label: 'What made your day happy',
      width: tableW - 100 - 60 - 150 - 170 - 190 - 160,
    },
    { key: 'happy_others', label: 'Made anybody else happy', width: 170 },
    { key: 'happy_goals', label: 'Goals & Self-Satisfaction', width: 190 },
    { key: 'happy_dreams', label: 'Dreams', width: 160 },
  ];

  const bodySize = 13;
  const linePad = 5;
  const cellPadY = 9;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  let height = margin; // top margin

  const headerH = 32;
  const footerH = 40;
  const titleBlockH = 68;
  height += titleBlockH + headerH;
  const cells = list.map((r) => {
    const { date, time } = formatDate(r.created_at);
    const values = {
      date,
      time,
      name: r.name,
      happy_one: r.happy_one,
      happy_others: r.happy_others ? r.happy_others : '—',
      happy_goals: r.happy_goals ? r.happy_goals : '—',
      happy_dreams: r.happy_dreams ? r.happy_dreams : '—',
    };
    return cols.map((c) => ({
      isName: c.key === 'name',
      lines: wrapText(ctx, values[c.key] || '', c.width - 8, bodySize, ''),
    }));
  });

  height += cells.reduce(
    (acc, row) =>
      acc +
      2 * cellPadY +
      Math.max(...row.map((cell) => cell.lines.length)) * (bodySize + linePad),
    0
  );
  height += footerH + margin; // bottom margin

  canvas.width = W * scale;
  canvas.height = Math.max(1, Math.ceil(height)) * scale;
  ctx.scale(scale, scale);

  ctx.fillStyle = COLORS.card;
  ctx.fillRect(0, 0, W, height);

  let y = margin;

  ctx.fillStyle = COLORS.accent;
  ctx.fillRect(margin, y, tableW, 3);
  y += 14;

  ctx.font = `700 20px ${FAMILY}`;
  ctx.fillStyle = COLORS.ink;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('Happy Sheet', margin, y + 16);
  y += 34;

  ctx.font = `400 13px ${FAMILY}`;
  ctx.fillStyle = COLORS.muted;
  ctx.fillText(
    `${scopeLabel(day)} \u00b7 ${list.length} answer${list.length === 1 ? '' : 's'}`,
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
    ctx.fillText(c.label.toUpperCase(), headerX[i] + 12, y + 20);
  });
  y += headerH;

  const lineHeight = bodySize + linePad;

  cells.forEach((row, rowIndex) => {
    const rowH =
      2 * cellPadY + Math.max(...row.map((cell) => cell.lines.length)) * lineHeight;

    if (rowIndex % 2 === 1) {
      ctx.fillStyle = COLORS.rowAlt;
      ctx.fillRect(margin, y, tableW, rowH);
    }

    row.forEach(({ isName, lines }, i) => {
      ctx.fillStyle = isName ? COLORS.ink : COLORS.muted;
      ctx.font =
        isName ? `600 ${bodySize}px ${FAMILY}` : `400 ${bodySize}px ${FAMILY}`;
      lines.forEach((line, li) => {
        ctx.fillText(line, headerX[i] + 12, y + cellPadY + 13 + li * lineHeight);
      });
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
  ctx.fillText(`Generated ${stamp} \u00b7 Ticket Manager`, margin, y + footerH - 16);

  const when = day;
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `happy-sheet-${(when || 'all').replace(/[^a-z0-9-]/gi, '_')}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'image/png');
}