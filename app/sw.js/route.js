export const dynamic = 'force-dynamic';

export async function GET() {
  // Gracefully self-unregister any leftover service workers registered on localhost/domain
  const script = `
    self.addEventListener('install', () => self.skipWaiting());
    self.addEventListener('activate', () => {
      self.registration.unregister();
    });
  `.trim();

  return new Response(script, {
    status: 200,
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  });
}
