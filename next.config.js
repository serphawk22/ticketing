/** @type {import('next').NextConfig} */
const nextConfig = {
  // These ship native bindings. They must be required by Node at runtime
  // instead of being bundled, otherwise the drivers fail to load on the
  // server (Vercel) and inside the dev server.
  serverExternalPackages: ['better-sqlite3', '@libsql/client'],
};

module.exports = nextConfig;
