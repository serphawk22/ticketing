import sharp from 'sharp';

const IMAGE_WIDTH = 1200;
const PAGE_CONTENT_HEIGHT = 4500;
const LEFT = 48;
const CONTENT_WIDTH = IMAGE_WIDTH - LEFT * 2;

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function wrapText(value, maxLength = 106) {
  const words = String(value ?? '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (!words.length) return ['Not provided'];

  const lines = [];
  let line = '';
  for (const word of words) {
    if (word.length > maxLength) {
      if (line) {
        lines.push(line);
        line = '';
      }
      for (let offset = 0; offset < word.length; offset += maxLength) {
        lines.push(word.slice(offset, offset + maxLength));
      }
      continue;
    }

    const next = line ? `${line} ${word}` : word;
    if (next.length > maxLength && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function normalizeEntry(entry) {
  const fields = (entry.fields || []).map(({ label, value }) => ({
    label: String(label || ''),
    lines: wrapText(value),
  }));
  const height = 66 + fields.reduce((total, field) => total + 20 + field.lines.length * 22, 0);
  return { ...entry, fields, height };
}

function paginate(entries) {
  const pages = [];
  let page = [];
  let usedHeight = 0;
  for (const entry of entries) {
    if (page.length && usedHeight + entry.height > PAGE_CONTENT_HEIGHT) {
      pages.push(page);
      page = [];
      usedHeight = 0;
    }
    page.push(entry);
    usedHeight += entry.height + 16;
  }
  pages.push(page);
  return pages;
}

function pageSvg({ reportDate, title, entries, pageNumber, pageCount }) {
  let y = 190;
  const body = [
    `<rect width="${IMAGE_WIDTH}" height="100%" fill="#f6f8fb"/>`,
    `<rect x="0" y="0" width="${IMAGE_WIDTH}" height="10" fill="#0c66e4"/>`,
    `<text x="${LEFT}" y="62" font-family="Arial,sans-serif" font-size="18" font-weight="700" fill="#0c66e4">SERPHAWK TICKET MANAGER</text>`,
    `<text x="${LEFT}" y="112" font-family="Arial,sans-serif" font-size="30" font-weight="700" fill="#101828">${escapeXml(title)}</text>`,
    `<text x="${LEFT}" y="150" font-family="Arial,sans-serif" font-size="17" fill="#667085">Report date: ${escapeXml(reportDate)}</text>`,
    `<text x="${LEFT}" y="176" font-family="Arial,sans-serif" font-size="15" fill="#667085">${entries.length} response${entries.length === 1 ? '' : 's'} on this page</text>`,
  ];

  if (!entries.length) {
    body.push(
      `<rect x="${LEFT}" y="${y}" width="${CONTENT_WIDTH}" height="82" rx="8" fill="#ffffff" stroke="#e5e7eb"/>`,
      `<text x="${LEFT + 22}" y="${y + 48}" font-family="Arial,sans-serif" font-size="17" fill="#475467">No responses were submitted for this sheet on this date.</text>`
    );
    y += 100;
  }

  for (const entry of entries) {
    body.push(
      `<rect x="${LEFT}" y="${y}" width="${CONTENT_WIDTH}" height="${entry.height}" rx="8" fill="#ffffff" stroke="#e5e7eb"/>`,
      `<text x="${LEFT + 20}" y="${y + 30}" font-family="Arial,sans-serif" font-size="18" font-weight="700" fill="#101828">${escapeXml(entry.name || 'Unnamed employee')}</text>`,
      `<text x="${LEFT + 20}" y="${y + 52}" font-family="Arial,sans-serif" font-size="13" fill="#667085">Submitted ${escapeXml(entry.submitted || 'time not recorded')}</text>`
    );

    let fieldY = y + 78;
    for (const field of entry.fields) {
      body.push(
        `<text x="${LEFT + 20}" y="${fieldY}" font-family="Arial,sans-serif" font-size="13" font-weight="700" fill="#475467">${escapeXml(field.label)}</text>`
      );
      fieldY += 19;
      for (const [index, line] of field.lines.entries()) {
        body.push(
          `<text x="${LEFT + 20}" y="${fieldY + index * 22}" font-family="Arial,sans-serif" font-size="15" fill="#1f2937">${escapeXml(line)}</text>`
        );
      }
      fieldY += field.lines.length * 22 + 10;
    }
    y += entry.height + 16;
  }

  const height = Math.max(420, y + 64);
  body.push(
    `<text x="${LEFT}" y="${height - 24}" font-family="Arial,sans-serif" font-size="12" fill="#98a2b3">Confidential employee responses · Page ${pageNumber} of ${pageCount}</text>`
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${IMAGE_WIDTH}" height="${height}" viewBox="0 0 ${IMAGE_WIDTH} ${height}">${body.join('')}</svg>`;
}

export async function buildDailySheetReportImages({ reportDate, sections }) {
  const attachments = [];
  for (const section of sections) {
    const isTask = /task/i.test(section.title);
    const baseSlug = isTask ? 'task-sheet-summary' : 'happy-sheet-summary';
    const entries = (section.entries || []).map(normalizeEntry);
    const pages = paginate(entries);

    for (let i = 0; i < pages.length; i += 1) {
      const filename =
        pages.length === 1
          ? `${baseSlug}-${reportDate}.png`
          : `${baseSlug}-${reportDate}-part-${i + 1}.png`;

      const svg = pageSvg({
        title: section.title,
        entries: pages[i],
        reportDate,
        pageNumber: i + 1,
        pageCount: pages.length,
      });

      const content = await sharp(Buffer.from(svg)).png().toBuffer();
      attachments.push({
        filename,
        content,
        contentType: 'image/png',
      });
    }
  }
  return attachments;
}
