#!/usr/bin/env node
/**
 * Out-of-band CLI script to bootstrap the initial Business Owner account.
 * Unconditionally refuses to execute once an owner exists or
 * app_settings.owner_bootstrap_completed = '1'.
 *
 * Usage:
 *   node scripts/bootstrap-owner.mjs --email=founder@company.com [--name="Founder"] [--password="..."]
 */
import '../lib/db.js';
import { bootstrapOwnerAccount } from '../lib/ownerGovernance.js';

function parseArg(prefix) {
  const found = process.argv.slice(2).find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : '';
}

async function main() {
  const email = parseArg('--email=');
  const name = parseArg('--name=');
  const password = parseArg('--password=') || null;

  if (!email) {
    console.error('Usage: node scripts/bootstrap-owner.mjs --email=owner@company.com [--name="Name"] [--password="..."]');
    process.exit(1);
  }

  const owner = await bootstrapOwnerAccount({ email, name, password });
  console.log(`Business Owner bootstrapped successfully: id=${owner.id}, email=${owner.email}, role=${owner.role}`);
}

main().catch((err) => {
  console.error('[bootstrap-owner] ERROR:', err.message);
  process.exit(1);
});
