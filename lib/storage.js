import fs from 'fs/promises';
import path from 'path';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const BUCKET = 'ticket-attachments';
const LOCAL_ROOT = path.resolve(process.cwd(), 'data', 'attachments');

let client;

export function usesRemoteStorage() {
  return Boolean(
    process.env.AWS_ENDPOINT_URL_S3 &&
      process.env.AWS_ACCESS_KEY_ID &&
      process.env.AWS_SECRET_ACCESS_KEY
  );
}

function s3() {
  if (!client) {
    if (!usesRemoteStorage()) {
      throw new Error('Object storage is not configured.');
    }
    client = new S3Client({
      region: process.env.AWS_REGION || 'us-east-2',
      endpoint: process.env.AWS_ENDPOINT_URL_S3,
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    });
  }
  return client;
}

// Remote storage when the Neon bucket is configured, and the local data
// directory otherwise. Uploads stay available on a machine that has no
// AWS_* credentials.
export function storageAvailable() {
  return true;
}

function localFile(key) {
  const full = path.resolve(LOCAL_ROOT, String(key));
  const rel = path.relative(LOCAL_ROOT, full);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Invalid attachment path.');
  }
  return full;
}

export function attachmentKey(ticketId, filename) {
  const safe = String(filename)
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(-80);
  return `tickets/${ticketId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe || 'file'}`;
}

export async function putAttachment(key, body, contentType) {
  if (usesRemoteStorage()) {
    await s3().send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType || 'application/octet-stream',
      })
    );
    return key;
  }

  const dest = localFile(key);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, body);
  return key;
}

export async function deleteAttachment(key) {
  if (usesRemoteStorage()) {
    await s3().send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
    return;
  }
  await fs.unlink(localFile(key)).catch((err) => {
    if (err.code !== 'ENOENT') throw err;
  });
}

export async function readAttachment(key) {
  if (usesRemoteStorage()) {
    const result = await s3().send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    return Buffer.from(await result.Body.transformToByteArray());
  }
  return fs.readFile(localFile(key));
}

export async function downloadAttachment(key) {
  if (usesRemoteStorage()) {
    return s3().send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  }
  return { Body: await readAttachment(key) };
}

export async function presignedAttachmentUrl(key, expiresIn = 900) {
  return getSignedUrl(
    s3(),
    new GetObjectCommand({ Bucket: BUCKET, Key: key }),
    { expiresIn }
  );
}

// A URL the browser can open. Remote files use a short-lived bucket link.
// Local files stay on this app so the session cookie still gates them.
export async function attachmentOpenUrl(attachment) {
  if (usesRemoteStorage()) {
    return presignedAttachmentUrl(attachment.storage_key, 900);
  }
  return `/api/tickets/${attachment.ticket_id}/attachments/${attachment.id}`;
}
