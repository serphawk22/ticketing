import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';

// Execute the actual route without starting Next.js or initializing a database.
const source = await readFile(new URL('../app/api/whatsapp/webhook/route.js', import.meta.url), 'utf8');
const { GET, POST } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const originalToken = process.env.WHATSAPP_VERIFY_TOKEN;
const originalSecret = process.env.WHATSAPP_APP_SECRET;
after(() => {
  for (const [key, value] of [['WHATSAPP_VERIFY_TOKEN', originalToken], ['WHATSAPP_APP_SECRET', originalSecret]]) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('Meta verification returns the raw challenge and rejects invalid or unconfigured requests', async () => {
  process.env.WHATSAPP_VERIFY_TOKEN = 'test-verification-token';
  const url = new URL('https://example.com/api/whatsapp/webhook');
  url.search = new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.verify_token': 'test-verification-token', 'hub.challenge': '123456789' });
  const response = await GET(new Request(url));
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '123456789');
  assert.match(response.headers.get('content-type'), /^text\/plain/);
  for (const [key, value] of [['hub.verify_token', 'wrong'], ['hub.mode', 'wrong'], ['hub.challenge', '']]) {
    const invalid = new URL(url);
    invalid.searchParams.set(key, value);
    assert.equal((await GET(new Request(invalid))).status, 403);
  }
  delete process.env.WHATSAPP_VERIFY_TOKEN;
  assert.equal((await GET(new Request(url))).status, 503);
});

test('events require a valid HMAC over the exact request bytes', async () => {
  process.env.WHATSAPP_APP_SECRET = 'test-app-secret';
  const body = '{ "object": "whatsapp_business_account", "entry": [] }';
  const signature = `sha256=${createHmac('sha256', 'test-app-secret').update(body).digest('hex')}`;
  const request = (data = body, sig = signature) => new Request('https://example.com/api/whatsapp/webhook', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig }, body: data,
  });
  const response = await POST(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { received: true });
  assert.equal((await POST(request(body + ' '))).status, 403);
  for (const sig of ['', 'sha256=abc', `sha256=${'0'.repeat(64)}`, `sha256=${'z'.repeat(64)}`]) {
    assert.equal((await POST(request(body, sig))).status, 403);
  }
  for (const invalid of ['{', 'null', '{"object":"page","entry":[]}', '{"object":"whatsapp_business_account"}']) {
    const signed = `sha256=${createHmac('sha256', 'test-app-secret').update(invalid).digest('hex')}`;
    assert.equal((await POST(request(invalid, signed))).status, 400);
  }
  delete process.env.WHATSAPP_APP_SECRET;
  assert.equal((await POST(request())).status, 503);
});
