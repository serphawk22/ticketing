#!/usr/bin/env node
/**
 * Out-of-band CLI recovery script to restore Business Owner access
 * if zero active owners remain (or to add a co-owner with explicit approval).
 *
 * Usage:
 *   node scripts/recover-owner-access.mjs --email=admin@company.com --reason="Original owner offboarded" [--allow-co-owner]
 */
import '../lib/db.js';
import { recoverOwnerAccess } from '../lib/ownerGovernance.js';

function parseArg(prefix) {
  const found = process.argv.slice(2).find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : '';
}

async function main() {
  const email = parseArg('--email=');
  const reason = parseArg('--reason=');
  const allowCoOwner = process.argv.includes('--allow-co-owner');

  if (!email || !reason) {
    console.error(
      'Usage: node scripts/recover-owner-access.mjs --email=user@company.com --reason="Audit reason" [--allow-co-owner]'
    );
    process.exit(1);
  }

  const owner = await recoverOwnerAccess({ email, reason, allowCoOwner });
  console.log(`Business Owner recovery succeeded: id=${owner.id}, email=${owner.email}, role=${owner.role}`);
}

main().catch((err) => {
  console.error('[recover-owner-access] ERROR:', err.message);
  process.exit(1);
});
