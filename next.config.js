const fs = require('fs');
const os = require('os');
const path = require('path');

const projectDir = __dirname;

// OneDrive "Files On-Demand" turns files it does not consider active into
// cloud-only placeholders (Windows reparse points). Next reads its own build
// output back with Node's readlink(), which fails on those placeholders with
// `EINVAL: invalid argument, readlink ...`. That breaks both `next dev` and
// `next start` (seen on `.next/server/vendor-chunks/*.js`).
//
// Fix: when this project lives inside a synced OneDrive folder, keep the build
// output outside of OneDrive, in the user's home directory, so every generated
// file stays a real, local file. Node still has to resolve dependencies
// (`react`, `next`, ...) from those generated files, so we point a
// `node_modules` junction at the project's real node_modules. The junction
// lives *beside* the build directory (not inside it), because Next wipes the
// contents of distDir on every build and would delete it.
//
// Everywhere else (CI, Vercel, a normal clone) the default `.next` is used.
const oneDriveRoot = process.env.OneDrive || path.join(os.homedir(), 'OneDrive');
const normalizedProject = projectDir.toLowerCase();
const normalizedOneDrive = oneDriveRoot.toLowerCase();
const isInsideOneDrive =
  normalizedProject === normalizedOneDrive ||
  normalizedProject.startsWith(normalizedOneDrive + path.sep);

let distDir;
if (isInsideOneDrive) {
  const buildRoot = path.join(os.homedir(), '.next-ticketing');
  const modulesLink = path.join(buildRoot, 'node_modules');
  try {
    fs.mkdirSync(buildRoot, { recursive: true });
    if (!fs.existsSync(modulesLink)) {
      fs.symlinkSync(path.join(projectDir, 'node_modules'), modulesLink, 'junction');
    }
    if (fs.existsSync(modulesLink)) {
      distDir = path.relative(projectDir, path.join(buildRoot, 'build'));
    }
  } catch {
    // Could not prepare the external build directory (e.g. a locked or existing
    // link). Fall back to the default in-project `.next` so the app still runs.
    distDir = undefined;
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  // better-sqlite3 ships a native binding. It must be required by Node at
  // runtime instead of being bundled, otherwise the driver fails to load on the
  // server (Vercel) and inside the dev server. pg is pure JavaScript but is
  // listed for the same reason: it reaches for optional native accelerators and
  // must stay a real Node require rather than an inlined bundle.
  serverExternalPackages: ['better-sqlite3', 'pg', '@vercel/functions'],

  ...(distDir ? { distDir } : {}),
};

module.exports = nextConfig;
