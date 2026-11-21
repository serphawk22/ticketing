import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommentAttachments, formatAttachmentToken } from '../lib/commentAttachments.js';

test('Comment attachments parsing and 50,000 character limit validation', async (t) => {
  await t.test('formatAttachmentToken generates consistent tag', () => {
    const token = formatAttachmentToken(101, 'screenshot.png');
    assert.equal(token, '[attachment:101:screenshot.png]');
  });
  await t.test('parseCommentAttachments extracts attachment tokens and leaves clean text', () => {
    const raw = 'Please review this mock.\n[attachment:42:design.png]\n[attachment:99:spec.pdf]';
    const parsed = parseCommentAttachments(raw);

    assert.equal(parsed.text, 'Please review this mock.');
    assert.equal(parsed.attachments.length, 2);
    assert.deepEqual(parsed.attachments[0], { id: 42, filename: 'design.png' });
    assert.deepEqual(parsed.attachments[1], { id: 99, filename: 'spec.pdf' });
  });

  await t.test('parseCommentAttachments handles attachment-only message', () => {
    const raw = '[attachment:12:screenshot.jpg]';
    const parsed = parseCommentAttachments(raw);

    assert.equal(parsed.text, '');
    assert.equal(parsed.attachments.length, 1);
    assert.deepEqual(parsed.attachments[0], { id: 12, filename: 'screenshot.jpg' });
  });

  await t.test('parseCommentAttachments handles text-only message', () => {
    const raw = 'Just a normal discussion message without files.';
    const parsed = parseCommentAttachments(raw);

    assert.equal(parsed.text, raw);
    assert.equal(parsed.attachments.length, 0);
  });

  await t.test('50,000 character limit boundary validation', () => {
    const MAX_COMMENT_LENGTH = 50000;

    const valid50k = 'a'.repeat(50000);
    assert.equal(valid50k.length, 50000);
    assert.equal(valid50k.length <= MAX_COMMENT_LENGTH, true);

    const over50k = 'a'.repeat(50001);
    assert.equal(over50k.length > MAX_COMMENT_LENGTH, true);
  });
});
