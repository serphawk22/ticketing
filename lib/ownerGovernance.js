import bcrypt from 'bcryptjs';
import { db } from './db.js';
import { passwordProblems } from './users.js';
import { isOwner, normalizeRole } from './rbac.js';

const BCRYPT_ROUNDS = 10;

async function ensureBootstrapSetting(tx, value, actorId = null) {
  await tx
    .prepare(
      `INSERT INTO app_settings (key, value, description, updated_at, updated_by)
       VALUES ('owner_bootstrap_completed', ?, 'Locks one-time CLI Business Owner bootstrap', datetime('now'), ?)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         updated_at = datetime('now'),
         updated_by = excluded.updated_by`
    )
    .run(value, actorId);
}

async function syncLinkedEmployeeRole(tx, userId, email, role) {
  const byUserId = await tx
    .prepare('SELECT id FROM employees WHERE user_id = ?')
    .get(Number(userId));
  if (byUserId) {
    await tx.prepare('UPDATE employees SET role = ? WHERE id = ?').run(role, byUserId.id);
    return;
  }
  if (email) {
    await tx
      .prepare('UPDATE employees SET role = ?, user_id = ? WHERE LOWER(email) = ?')
      .run(role, Number(userId), String(email).trim().toLowerCase());
  }
}

/**
 * Out-of-band CLI bootstrap for the very first Business Owner account.
 * Unconditionally refuses to run if an active `owner` exists OR if
 * `system_settings.owner_bootstrap_completed = '1'`.
 */
export async function bootstrapOwnerAccount({ email, name = '', password = null }) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    throw new Error('A valid owner email address is required.');
  }

  return db.transaction(async (tx) => {
    const existingOwner = await tx
      .prepare("SELECT id, email FROM users WHERE role = 'owner' LIMIT 1")
      .get();
    if (existingOwner) {
      throw new Error(`Owner bootstrap locked: an owner account already exists (${existingOwner.email}).`);
    }

    const lockSetting = await tx
      .prepare("SELECT value FROM app_settings WHERE key = 'owner_bootstrap_completed'")
      .get();
    if (lockSetting?.value === '1') {
      throw new Error('Owner bootstrap locked: owner_bootstrap_completed is already set.');
    }

    const existingUser = await tx
      .prepare('SELECT * FROM users WHERE LOWER(email) = ?')
      .get(cleanEmail);

    let ownerUserId;
    let action;

    if (existingUser) {
      if (existingUser.role === 'client') {
        throw new Error('Cannot promote a client portal account to Business Owner.');
      }
      await tx.prepare("UPDATE users SET role = 'owner' WHERE id = ?").run(existingUser.id);
      await syncLinkedEmployeeRole(tx, existingUser.id, existingUser.email, 'owner');
      ownerUserId = existingUser.id;
      action = 'owner_bootstrapped_from_existing_user';
    } else {
      const cleanName = String(name || '').trim();
      if (!cleanName) {
        throw new Error('Owner name is required when creating a new owner account.');
      }
      const problems = passwordProblems(password);
      if (problems.length > 0) {
        throw new Error(`Password must include ${problems.join(', ')}.`);
      }
      const hashed = bcrypt.hashSync(String(password), bcrypt.genSaltSync(BCRYPT_ROUNDS));
      const inserted = await tx
        .prepare(
          `INSERT INTO users (name, email, password, role, must_change_password)
           VALUES (?, ?, ?, 'owner', 0)`
        )
        .run(cleanName, cleanEmail, hashed);
      ownerUserId = inserted.lastInsertRowid;

      const existingEmp = await tx
        .prepare('SELECT id FROM employees WHERE LOWER(email) = ?')
        .get(cleanEmail);
      if (existingEmp) {
        await tx
          .prepare("UPDATE employees SET role = 'owner', user_id = ? WHERE id = ?")
          .run(ownerUserId, existingEmp.id);
      } else {
        await tx
          .prepare(
            `INSERT INTO employees (name, email, role, active, user_id, employment_status)
             VALUES (?, ?, 'owner', 1, ?, 'active')`
          )
          .run(cleanName, cleanEmail, ownerUserId);
      }
      action = 'owner_bootstrapped_new_account';
    }

    await ensureBootstrapSetting(tx, '1', ownerUserId);
    await tx
      .prepare(
        `INSERT INTO audit_logs (actor_id, actor_name, action, entity_type, entity_id, details)
         VALUES (?, ?, ?, 'user', ?, ?)`
      )
      .run(
        ownerUserId,
        cleanEmail,
        action,
        String(ownerUserId),
        JSON.stringify({ email: cleanEmail, via: 'cli_bootstrap' })
      );

    return tx.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(ownerUserId);
  });
}

/**
 * Transfers or shares Business Ownership while guaranteeing the minimum-1-owner invariant.
 */
export async function transferOwnership({
  actor,
  targetUserId,
  demoteActorToAdmin = true,
  reason = '',
}) {
  if (!isOwner(actor)) {
    throw new Error('Only an active Business Owner can transfer ownership.');
  }

  const targetId = Number(targetUserId);
  if (!Number.isInteger(targetId) || targetId <= 0) {
    throw new Error('A valid targetUserId is required.');
  }
  const cleanReason = String(reason || '').trim();
  if (cleanReason.length < 5) {
    throw new Error('A mandatory reason of at least 5 characters is required for ownership transfer.');
  }

  return db.transaction(async (tx) => {
    const actorRow = await tx.prepare('SELECT * FROM users WHERE id = ?').get(Number(actor.id));
    if (!actorRow || normalizeRole(actorRow.role) !== 'owner') {
      throw new Error('Only an active Business Owner can transfer ownership.');
    }

    const targetRow = await tx.prepare('SELECT * FROM users WHERE id = ?').get(targetId);
    if (!targetRow) {
      throw new Error('Target user account not found.');
    }
    if (normalizeRole(targetRow.role) === 'client') {
      throw new Error('Client portal accounts cannot hold Business Owner privileges.');
    }

    const linkedEmployee = await tx
      .prepare('SELECT id, active FROM employees WHERE user_id = ? OR LOWER(email) = ?')
      .get(targetId, String(targetRow.email || '').toLowerCase());
    if (linkedEmployee && !linkedEmployee.active) {
      throw new Error('Cannot transfer ownership to an inactive employee account.');
    }

    await tx.prepare("UPDATE users SET role = 'owner' WHERE id = ?").run(targetId);
    await syncLinkedEmployeeRole(tx, targetId, targetRow.email, 'owner');

    if (demoteActorToAdmin && Number(actorRow.id) !== targetId) {
      await tx.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(Number(actorRow.id));
      await syncLinkedEmployeeRole(tx, Number(actorRow.id), actorRow.email, 'admin');
    }

    const ownerCountRow = await tx
      .prepare("SELECT COUNT(*) AS cnt FROM users WHERE role = 'owner'")
      .get();
    if (Number(ownerCountRow?.cnt || 0) < 1) {
      throw new Error('Invariant violation: at least one Business Owner must remain active.');
    }

    await ensureBootstrapSetting(tx, '1', actorRow.id);
    await tx
      .prepare(
        `INSERT INTO audit_logs (actor_id, actor_name, action, entity_type, entity_id, details)
         VALUES (?, ?, 'ownership_transferred', 'user', ?, ?)`
      )
      .run(
        actorRow.id,
        actorRow.name || actorRow.email,
        String(targetId),
        JSON.stringify({
          fromUserId: actorRow.id,
          toUserId: targetId,
          toEmail: targetRow.email,
          demoteActorToAdmin: Boolean(demoteActorToAdmin),
          reason: cleanReason,
        })
      );

    return {
      newOwner: await tx.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(targetId),
      previousOwner: await tx.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(actorRow.id),
      ownerCount: Number(ownerCountRow.cnt),
    };
  });
}

/**
 * Out-of-band CLI recovery when zero owners remain or an emergency promotion is needed.
 */
export async function recoverOwnerAccess({ email, reason, allowCoOwner = false }) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanReason = String(reason || '').trim();
  if (!cleanEmail) throw new Error('Target email is required.');
  if (cleanReason.length < 5) throw new Error('A recovery reason of at least 5 characters is required.');

  return db.transaction(async (tx) => {
    const existingOwners = await tx.prepare("SELECT id, email FROM users WHERE role = 'owner'").all();
    if (existingOwners.length > 0 && !allowCoOwner) {
      throw new Error(
        `Active owner(s) exist (${existingOwners.map((o) => o.email).join(', ')}). Pass --allow-co-owner to promote an additional owner.`
      );
    }

    const target = await tx.prepare('SELECT * FROM users WHERE LOWER(email) = ?').get(cleanEmail);
    if (!target) {
      throw new Error(`No user account found with email ${cleanEmail}.`);
    }
    if (normalizeRole(target.role) === 'client') {
      throw new Error('Client portal accounts cannot be promoted to Business Owner.');
    }

    await tx.prepare("UPDATE users SET role = 'owner' WHERE id = ?").run(target.id);
    await syncLinkedEmployeeRole(tx, target.id, target.email, 'owner');
    await ensureBootstrapSetting(tx, '1', target.id);

    await tx
      .prepare(
        `INSERT INTO audit_logs (actor_id, actor_name, action, entity_type, entity_id, details)
         VALUES (?, ?, 'owner_recovery_promoted', 'user', ?, ?)`
      )
      .run(
        target.id,
        'CLI_RECOVERY',
        String(target.id),
        JSON.stringify({ email: cleanEmail, reason: cleanReason, allowCoOwner: Boolean(allowCoOwner) })
      );

    return tx.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(target.id);
  });
}
