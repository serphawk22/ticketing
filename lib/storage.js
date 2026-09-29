import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const BUCKET = 'ticket-attachments';

let client;

function s3() {
  if (!client) {
    const endpoint = process.env.AWS_ENDPOINT_URL_S3;
    if (!endpoint || !process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
      throw new Error(
        'Object storage is not configured. Run `neon env pull` to fetch the AWS_* variables.'
      );
    }
    client = new S3Client({
      region: process.env.AWS_REGION || 'us-east-2',
      endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    });
  }
  return client;
}

export function storageAvailable() {
  return Boolean(
    process.env.AWS_ENDPOINT_URL_S3 &&
      process.env.AWS_ACCESS_KEY_ID &&
      process.env.AWS_SECRET_ACCESS_KEY
  );
}

export function attachmentKey(ticketId, filename) {
  const safe = String(filename)
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(-80);
  return `tickets/${ticketId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe || 'file'}`;
}

export async function putAttachment(key, body, contentType) {
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

export async function deleteAttachment(key) {
  await s3().send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

export async function downloadAttachment(key) {
  return s3().send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
}

export async function presignedAttachmentUrl(key, expiresIn = 900) {
  return getSignedUrl(
    s3(),
    new GetObjectCommand({ Bucket: BUCKET, Key: key }),
    { expiresIn }
  );
}
