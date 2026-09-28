/** @type {import('next').NextConfig} */
const nextConfig = {
  // better-sqlite3 ships a native binding. It must be required by Node at
  // runtime instead of being bundled, otherwise the driver fails to load on the
  // server (Vercel) and inside the dev server. pg is pure JavaScript but is
  // listed for the same reason: it reaches for optional native accelerators and
  // must stay a real Node require rather than an inlined bundle.
  serverExternalPackages: ['better-sqlite3', 'pg', '@vercel/functions'],
};

module.exports = nextConfig;
