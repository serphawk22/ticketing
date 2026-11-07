export const runtime = 'nodejs';

let cachedPayload = null;

export async function GET() {
  if (!cachedPayload) {
    const { default: dictionary } = await import('dictionary-en');
    cachedPayload = {
      aff: Buffer.from(dictionary.aff).toString('utf8'),
      dic: Buffer.from(dictionary.dic).toString('utf8'),
    };
  }

  return Response.json(cachedPayload, {
    headers: {
      'Cache-Control': 'public, max-age=86400, immutable',
    },
  });
}
