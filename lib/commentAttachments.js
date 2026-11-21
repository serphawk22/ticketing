/**
 * Parses embedded attachment tokens in comment bodies.
 * Format: [attachment:<id>:<filename>]
 */
export function parseCommentAttachments(body) {
  if (!body) return { text: '', attachments: [] };
  const attachments = [];
  const regex = /\[attachment:(\d+):([^\]]+)\]/g;
  let match;
  while ((match = regex.exec(body)) !== null) {
    attachments.push({ id: Number(match[1]), filename: match[2] });
  }
  const cleanText = body.replace(regex, '').trim();
  return { text: cleanText, attachments };
}

export function formatAttachmentToken(id, filename) {
  const safeName = String(filename || 'file').replace(/[\]\r\n]/g, '');
  return `[attachment:${id}:${safeName}]`;
}
