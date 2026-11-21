import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

// Clean up any test artifacts created in data/attachments
const TEST_ATTACHMENT_DIR = path.resolve(ROOT_DIR, 'data/attachments/test-storage');

test('Storage module behavior in local and serverless environments', async (t) => {
  // Preserve original environment
  const originalEnv = { ...process.env };

  t.after(() => {
    // Restore environment
    process.env = { ...originalEnv };
    if (fs.existsSync(TEST_ATTACHMENT_DIR)) {
      fs.rmSync(TEST_ATTACHMENT_DIR, { recursive: true, force: true });
    }
  });

  await t.test('Local mode: storageAvailable() returns true without S3', async () => {
    delete process.env.VERCEL;
    delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    delete process.env.AWS_ENDPOINT_URL_S3;
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;

    // Dynamically re-import to pick up env
    const { storageAvailable, usesRemoteStorage, isServerlessEnvironment } = await import(
      `../lib/storage.js?t=${Date.now()}-1`
    );

    assert.equal(usesRemoteStorage(), false);
    assert.equal(isServerlessEnvironment(), false);
    assert.equal(storageAvailable(), true);
  });

  await t.test('Local mode: putAttachment, readAttachment, deleteAttachment work locally', async () => {
    delete process.env.VERCEL;
    delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    delete process.env.AWS_ENDPOINT_URL_S3;
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;

    const { putAttachment, readAttachment, deleteAttachment } = await import(
      `../lib/storage.js?t=${Date.now()}-2`
    );

    const testKey = 'test-storage/sample.txt';
    const testContent = Buffer.from('Hello attachment storage!');

    const returnedKey = await putAttachment(testKey, testContent, 'text/plain');
    assert.equal(returnedKey, testKey);

    const readBack = await readAttachment(testKey);
    assert.equal(readBack.toString(), 'Hello attachment storage!');

    await deleteAttachment(testKey);
    await assert.rejects(async () => {
      await readAttachment(testKey);
    });
  });

  await t.test('Serverless mode (Vercel): storageAvailable() returns false when S3 is missing', async () => {
    process.env.VERCEL = '1';
    delete process.env.AWS_ENDPOINT_URL_S3;
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;

    const { storageAvailable, usesRemoteStorage, isServerlessEnvironment, putAttachment, readAttachment } = await import(
      `../lib/storage.js?t=${Date.now()}-3`
    );

    assert.equal(usesRemoteStorage(), false);
    assert.equal(isServerlessEnvironment(), true);
    assert.equal(storageAvailable(), false);

    // Verify it refuses to write to local filesystem in serverless mode
    await assert.rejects(
      async () => {
        await putAttachment('test-storage/fail.txt', Buffer.from('test'), 'text/plain');
      },
      (err) => {
        assert.match(err.message, /Remote object storage is not configured/);
        assert.match(err.message, /serverless/);
        return true;
      }
    );

    // Verify readAttachment also refuses to read local disk in serverless mode
    await assert.rejects(
      async () => {
        await readAttachment('test-storage/fail.txt');
      },
      (err) => {
        assert.match(err.message, /Cannot read local attachment in serverless environment/);
        return true;
      }
    );
  });

  await t.test('Serverless mode (Vercel): storageAvailable() returns true when S3 is configured', async () => {
    process.env.VERCEL = '1';
    process.env.AWS_ENDPOINT_URL_S3 = 'https://example.storage.neon.tech';
    process.env.AWS_ACCESS_KEY_ID = 'test_key_id';
    process.env.AWS_SECRET_ACCESS_KEY = 'test_secret_key';
    process.env.AWS_REGION = 'us-east-2';

    const { storageAvailable, usesRemoteStorage, isServerlessEnvironment } = await import(
      `../lib/storage.js?t=${Date.now()}-4`
    );

    assert.equal(usesRemoteStorage(), true);
    assert.equal(isServerlessEnvironment(), true);
    assert.equal(storageAvailable(), true);
  });

  await t.test('Employee document safety in serverless mode without S3', async () => {
    process.env.VERCEL = '1';
    delete process.env.AWS_ENDPOINT_URL_S3;
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;

    const { createEmployeeDocument } = await import(
      `../lib/employeeDocs.js?t=${Date.now()}-5`
    );

    await assert.rejects(
      async () => {
        await createEmployeeDocument({
          workspaceId: 1,
          employeeId: 1,
          docType: 'other',
          title: 'Test Doc',
          fileName: 'test.pdf',
          fileSize: 100,
          mimeType: 'application/pdf',
          buffer: Buffer.from('dummy-pdf'),
        });
      },
      (err) => {
        assert.match(err.message, /Employee document storage is not configured/);
        assert.match(err.message, /serverless/);
        return true;
      }
    );
  });
});
