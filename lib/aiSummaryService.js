import { db } from './db.js';
import { getVerifiedProjectMetrics } from './aiDataAggregator.js';
import { generateGeminiProgressSummary } from './aiGemini.js';
import { getProject } from './projects.js';
import { todayKolkataDate } from './workLedger.js';
import {
  assertCanViewProject,
  isAdminOrOwner,
  isClient,
  isManager,
  isTeamUser,
  resolveUserScope,
} from './rbac.js';

const inFlightGenerations = new Map();

/**
 * Checks if a user has authorization to view the summary for a given scope
 */
export async function canUserAccessScope(user, scopeType, projectId) {
  if (!user) return false;
  if (isAdminOrOwner(user)) return true;

  if (scopeType === 'overall') {
    // Only Owners and Administrators can see organization-wide overall summaries
    return false;
  }

  // Project-specific check
  const numericId = Number(projectId);
  if (!numericId) return false;

  const project = await getProject(numericId);
  if (!project) return false;

  if (isClient(user)) {
    // Clients only see projects they explicitly own
    return Number(project.client_id) === Number(user.id);
  }

  if (isManager(user)) {
    const access = await assertCanViewProject(user, numericId);
    return access.allowed;
  }

  // Internal employee/developer role on an existing project
  return isTeamUser(user);
}

/**
 * Checks if a user has authorization to generate/regenerate an AI summary
 */
export function canUserGenerateSummary(user) {
  if (!user) return false;
  // Clients are strictly read-only; internal team members (owner, admin, manager, employee/developer) can generate
  return isTeamUser(user);
}

/**
 * Normalizes a database row into a structured summary object
 */
function formatSummaryRow(row) {
  if (!row) return null;

  let achievements = [];
  let blockers = [];
  let recommendations = [];
  let metricsSnapshot = {};

  try {
    achievements = JSON.parse(row.achievements_json || '[]');
  } catch {}
  try {
    blockers = JSON.parse(row.blockers_json || '[]');
  } catch {}
  try {
    recommendations = JSON.parse(row.recommendations_json || '[]');
  } catch {}
  try {
    metricsSnapshot = JSON.parse(row.metrics_snapshot_json || '{}');
  } catch {}

  // Extract structured intelligence fields with backward-compatible defaults
  const historicalAchievements = Array.isArray(metricsSnapshot.historicalAchievements)
    ? metricsSnapshot.historicalAchievements
    : [];
  const recentAchievements = Array.isArray(metricsSnapshot.recentAchievements) && metricsSnapshot.recentAchievements.length
    ? metricsSnapshot.recentAchievements
    : achievements;
  const currentDevelopment = Array.isArray(metricsSnapshot.currentDevelopment)
    ? metricsSnapshot.currentDevelopment
    : [];
  const activeBlockers = Array.isArray(metricsSnapshot.activeBlockers) && metricsSnapshot.activeBlockers.length
    ? metricsSnapshot.activeBlockers
    : blockers;
  const upcomingWork = Array.isArray(metricsSnapshot.upcomingWork)
    ? metricsSnapshot.upcomingWork
    : [];
  const dependencies = Array.isArray(metricsSnapshot.dependencies)
    ? metricsSnapshot.dependencies
    : [];
  const ticketCoverage = metricsSnapshot.ticketCoverage || null;

  return {
    id: row.id,
    scopeType: row.scope_type,
    projectId: row.project_id,
    healthStatus: row.health_status,
    headline: row.headline,
    summaryText: row.summary_text,
    achievements,
    blockers,
    recommendations,
    metricsSnapshot,
    historicalAchievements,
    recentAchievements,
    currentDevelopment,
    activeBlockers,
    upcomingWork,
    dependencies,
    ticketCoverage,
    modelName: row.model_name,
    generatedBy: row.generated_by,
    generatedByName: row.generated_by_name || 'Team Member',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Retrieves the cached AI progress summary for a given project or overall scope.
 * Zero LLM calls are made here.
 *
 * @param {number|string|null} projectId - Project ID, or 'all'/null for overall.
 */
export async function getCachedAiSummary(projectId) {
  const isOverall = !projectId || projectId === 'all';
  const numericId = isOverall ? null : Number(projectId);

  let sql;
  let params;

  if (isOverall) {
    sql = `
      SELECT s.*, u.name AS generated_by_name
      FROM ai_progress_summaries s
      LEFT JOIN users u ON u.id = s.generated_by
      WHERE s.scope_type = 'overall' AND s.project_id IS NULL
      LIMIT 1
    `;
    params = [];
  } else {
    sql = `
      SELECT s.*, u.name AS generated_by_name
      FROM ai_progress_summaries s
      LEFT JOIN users u ON u.id = s.generated_by
      WHERE s.scope_type = 'project' AND s.project_id = ?
      LIMIT 1
    `;
    params = [numericId];
  }

  const row = await db.prepare(sql).get(...params);
  if (!row) {
    return { exists: false, summary: null };
  }

  return {
    exists: true,
    summary: formatSummaryRow(row),
  };
}

/**
 * Manually generates a fresh AI progress summary using verified metrics
 * and upserts it into the cache table.
 *
 * @param {{ projectId: number|string|null, user: object }} options
 */
export async function generateAndCacheAiSummary({ projectId, user }) {
  const isOverall = !projectId || projectId === 'all';
  const numericId = isOverall ? null : Number(projectId);
  const scopeType = isOverall ? 'overall' : 'project';

  // 1. Authorize user
  const canAccess = await canUserAccessScope(user, scopeType, numericId);
  if (!canAccess) {
    throw new Error('Forbidden: You are not authorized to view or generate summaries for this project.');
  }

  if (!canUserGenerateSummary(user)) {
    throw new Error('Forbidden: Your account role does not have permission to generate AI summaries.');
  }

  const scopeKey = isOverall ? 'overall' : `project:${numericId}`;
  if (inFlightGenerations.has(scopeKey)) {
    return inFlightGenerations.get(scopeKey);
  }

  const generationPromise = (async () => {
    // 2. Compute verified numerical metrics directly from database SQL
    const verifiedMetrics = await getVerifiedProjectMetrics(numericId);

    // 3. Call AI API to interpret verified data (OpenAI prioritized, Gemini fallback)
    let aiResult;
    if (process.env.OPENAI_API_KEY) {
      aiResult = await generateOpenAiProgressSummary(verifiedMetrics);
    } else if (process.env.GEMINI_API_KEY) {
      aiResult = await generateGeminiProgressSummary(verifiedMetrics);
    } else {
      throw new Error(
        'OPENAI_API_KEY is not configured in the server environment (.env). Please add your OpenAI API key.'
      );
    }

    // 4. Upsert into database
    const nowIso = new Date().toISOString();
    const achievementsStr = JSON.stringify(aiResult.achievements || []);
    const blockersStr = JSON.stringify(aiResult.blockers || []);
    const recsStr = JSON.stringify(aiResult.recommendations || []);

    // Enriched metrics snapshot storing complete ticket intelligence and structured categories
    const enrichedMetrics = {
      ...(verifiedMetrics.metrics || {}),
      projectTargetEndDate: verifiedMetrics.projectTargetEndDate || null,
      ticketCoverage: verifiedMetrics.ticketsDigest?.coverage || null,
      historicalAchievements: aiResult.historicalAchievements || [],
      recentAchievements: aiResult.recentAchievements || aiResult.achievements || [],
      currentDevelopment: aiResult.currentDevelopment || [],
      activeBlockers: aiResult.blockers || [],
      upcomingWork: aiResult.upcomingWork || [],
      dependencies: aiResult.dependencies || [],
    };
    const metricsStr = JSON.stringify(enrichedMetrics);

    // Check if row already exists
    const existingQuery = isOverall
      ? "SELECT id FROM ai_progress_summaries WHERE scope_type = 'overall' AND project_id IS NULL"
      : "SELECT id FROM ai_progress_summaries WHERE scope_type = 'project' AND project_id = ?";
    const existingParams = isOverall ? [] : [numericId];
    const existingRow = await db.prepare(existingQuery).get(...existingParams);

    if (existingRow?.id) {
      await db
        .prepare(
          `UPDATE ai_progress_summaries
           SET health_status = ?,
               headline = ?,
               summary_text = ?,
               achievements_json = ?,
               blockers_json = ?,
               recommendations_json = ?,
               metrics_snapshot_json = ?,
               model_name = ?,
               generated_by = ?,
               updated_at = ?
           WHERE id = ?`
        )
        .run(
          aiResult.healthStatus,
          aiResult.headline,
          aiResult.summaryText,
          achievementsStr,
          blockersStr,
          recsStr,
          metricsStr,
          aiResult.modelName,
          user.id,
          nowIso,
          existingRow.id
        );
    } else {
      await db
        .prepare(
          `INSERT INTO ai_progress_summaries (
             scope_type, project_id, health_status, headline, summary_text,
             achievements_json, blockers_json, recommendations_json,
             metrics_snapshot_json, model_name, generated_by, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          scopeType,
          numericId,
          aiResult.healthStatus,
          aiResult.headline,
          aiResult.summaryText,
          achievementsStr,
          blockersStr,
          recsStr,
          metricsStr,
          aiResult.modelName,
          user.id,
          nowIso,
          nowIso
        );
    }

    // 5. Return fresh summary
    const fresh = await getCachedAiSummary(numericId);
    return fresh.summary;
  })();

  inFlightGenerations.set(scopeKey, generationPromise);
  try {
    return await generationPromise;
  } finally {
    inFlightGenerations.delete(scopeKey);
  }
}

/**
 * Batch-retrieves project-wise cached AI progress summaries, project target dates,
 * live ticket counts, and active recorded blockers for Owner/Admin/Manager dashboards.
 * Never triggers LLM calls on page load.
 */
export async function getManagementProjectSummaries(user) {
  if (!user || (!isAdminOrOwner(user) && !isManager(user))) {
    const err = new Error('Forbidden: Owner, Administrator, or Manager access required.');
    err.statusCode = 403;
    throw err;
  }

  const scope = await resolveUserScope(user);
  const allowedProjectIds = scope.canViewAll ? null : Array.from(scope.scopedProjectIds);

  if (allowedProjectIds && allowedProjectIds.length === 0) {
    return { projects: [], generatedCount: 0, missingCount: 0 };
  }

  let projSql = `
    SELECT id, key, name, description, color, status, target_end_date
    FROM projects
  `;
  const projParams = [];
  if (allowedProjectIds) {
    projSql += ` WHERE id IN (${allowedProjectIds.map(() => '?').join(', ')})`;
    projParams.push(...allowedProjectIds);
  }
  projSql += ' ORDER BY name COLLATE NOCASE';

  const projects = (await db.prepare(projSql).all(...projParams)) || [];
  if (projects.length === 0) {
    return { projects: [], generatedCount: 0, missingCount: 0 };
  }

  const pids = projects.map((p) => Number(p.id));
  const ph = pids.map(() => '?').join(', ');
  const todayIst = todayKolkataDate();
  const fourteenDaysAgoDate = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const fourteenDaysAgoTs = `${fourteenDaysAgoDate} 00:00:00`;

  const [
    summaryRows,
    ticketAggRows,
    relationRows,
    labeledBlockedRows,
    workLogBlockerRows,
    taskSheetBlockerRows,
  ] = await Promise.all([
    db
      .prepare(
        `SELECT s.*, u.name AS generated_by_name
         FROM ai_progress_summaries s
         LEFT JOIN users u ON u.id = s.generated_by
         WHERE s.scope_type = 'project' AND s.project_id IN (${ph})`
      )
      .all(...pids),
    db
      .prepare(
        `SELECT
           t.project_id,
           COUNT(*) AS total,
           SUM(CASE WHEN t.status = 'open' THEN 1 ELSE 0 END) AS c_open,
           SUM(CASE WHEN t.status = 'in_progress' THEN 1 ELSE 0 END) AS c_in_progress,
           SUM(CASE WHEN t.status = 'resolved' THEN 1 ELSE 0 END) AS c_resolved,
           SUM(CASE WHEN t.status = 'closed' THEN 1 ELSE 0 END) AS c_closed,
           SUM(CASE WHEN t.status NOT IN ('resolved', 'closed')
                     AND t.due_date IS NOT NULL AND t.due_date != '' AND t.due_date < ?
               THEN 1 ELSE 0 END) AS c_overdue,
           SUM(CASE WHEN t.status NOT IN ('resolved', 'closed') AND t.priority = 'urgent'
               THEN 1 ELSE 0 END) AS c_urgent,
           MAX(t.updated_at) AS latest_ticket_updated_at
         FROM tickets t
         WHERE COALESCE(t.archived, 0) = 0
           AND t.project_id IN (${ph})
         GROUP BY t.project_id`
      )
      .all(todayIst, ...pids),
    db
      .prepare(
        `SELECT
           r.relation_type,
           t1.id AS t1_id, t1.title AS t1_title, t1.status AS t1_status, t1.project_id AS t1_project_id, p1.key AS p1_key,
           t2.id AS t2_id, t2.title AS t2_title, t2.status AS t2_status, t2.project_id AS t2_project_id, p2.key AS p2_key
         FROM ticket_relations r
         JOIN tickets t1 ON t1.id = r.ticket_id
         JOIN tickets t2 ON t2.id = r.related_ticket_id
         LEFT JOIN projects p1 ON p1.id = t1.project_id
         LEFT JOIN projects p2 ON p2.id = t2.project_id
         WHERE COALESCE(t1.archived, 0) = 0
           AND COALESCE(t2.archived, 0) = 0
           AND t1.status NOT IN ('resolved', 'closed')
           AND t2.status NOT IN ('resolved', 'closed')
           AND r.relation_type IN ('blocks', 'blocked_by', 'is blocked by')
           AND (t1.project_id IN (${ph}) OR t2.project_id IN (${ph}))`
      )
      .all(...pids, ...pids),
    db
      .prepare(
        `SELECT t.id, t.project_id, t.title, t.labels, p.key AS project_key
         FROM tickets t
         LEFT JOIN projects p ON p.id = t.project_id
         WHERE COALESCE(t.archived, 0) = 0
           AND t.status NOT IN ('resolved', 'closed')
           AND LOWER(COALESCE(t.labels, '')) LIKE '%blocked%'
           AND t.project_id IN (${ph})`
      )
      .all(...pids),
    db
      .prepare(
        `SELECT ewl.project_id, ewl.ticket_id, ewl.work_date, ewl.blocker_text,
                ewl.source_type, ewl.source_id, e.name AS employee_name
         FROM employee_work_logs ewl
         JOIN employees e ON e.id = ewl.employee_id
         WHERE ewl.project_id IN (${ph})
           AND ewl.duration_minutes > 0
           AND ewl.entry_kind != 'reversal_adjustment'
           AND ewl.blocker_text IS NOT NULL
           AND TRIM(ewl.blocker_text) != ''
           AND ewl.work_date >= ?
         ORDER BY ewl.work_date DESC, ewl.id DESC`
      )
      .all(...pids, fourteenDaysAgoDate),
    db
      .prepare(
        `SELECT ts.id, ts.name, ts.project, ts.blocker, ts.created_at,
                lt.project_id AS linked_project_id, lt.id AS linked_ticket_id
         FROM task_sheet_submissions ts
         LEFT JOIN tickets lt ON lt.id = ts.linked_ticket_id
         WHERE ts.blocker IS NOT NULL
           AND TRIM(ts.blocker) != ''
           AND ts.created_at >= ?
         ORDER BY ts.created_at DESC`
      )
      .all(fourteenDaysAgoTs),
  ]);

  const summaryByProject = new Map();
  for (const row of summaryRows || []) {
    summaryByProject.set(Number(row.project_id), formatSummaryRow(row));
  }

  const aggByProject = new Map();
  for (const row of ticketAggRows || []) {
    aggByProject.set(Number(row.project_id), row);
  }

  const blockersByProject = new Map();
  const seenBlockerKeys = new Map();
  const pushBlocker = (pid, blockerObj, dedupeKey) => {
    const numPid = Number(pid);
    if (!pids.includes(numPid)) return;
    if (!seenBlockerKeys.has(numPid)) seenBlockerKeys.set(numPid, new Set());
    const seen = seenBlockerKeys.get(numPid);
    if (dedupeKey && seen.has(dedupeKey)) return;
    if (dedupeKey) seen.add(dedupeKey);
    if (!blockersByProject.has(numPid)) blockersByProject.set(numPid, []);
    blockersByProject.get(numPid).push(blockerObj);
  };

  for (const rel of relationRows || []) {
    const rawK1 = `${rel.p1_key || 'TM'}-${rel.t1_id}`;
    const rawK2 = `${rel.p2_key || 'TM'}-${rel.t2_id}`;
    const k1 = `[${rawK1}]`;
    const k2 = `[${rawK2}]`;
    if (rel.relation_type === 'blocks' && rel.t2_project_id) {
      pushBlocker(
        rel.t2_project_id,
        {
          kind: 'ticket_relation',
          ticketId: Number(rel.t2_id),
          ticketKey: rawK2,
          text: `${k2} "${rel.t2_title}" is blocked by ${k1} (${rel.t1_title})`,
        },
        `rel:${rel.t2_id}:${rel.t1_id}`
      );
    } else if ((rel.relation_type === 'blocked_by' || rel.relation_type === 'is blocked by') && rel.t1_project_id) {
      pushBlocker(
        rel.t1_project_id,
        {
          kind: 'ticket_relation',
          ticketId: Number(rel.t1_id),
          ticketKey: rawK1,
          text: `${k1} "${rel.t1_title}" is blocked by ${k2} (${rel.t2_title})`,
        },
        `rel:${rel.t1_id}:${rel.t2_id}`
      );
    }
  }

  for (const bt of labeledBlockedRows || []) {
    const rawK = `${bt.project_key || 'TM'}-${bt.id}`;
    const k = `[${rawK}]`;
    pushBlocker(
      bt.project_id,
      {
        kind: 'ticket_label',
        ticketId: Number(bt.id),
        ticketKey: rawK,
        text: `${k} "${bt.title}" is marked as blocked`,
      },
      `lbl:${bt.id}`
    );
  }
  const aiResult = await generateGeminiProgressSummary(verifiedMetrics);

  const loggedTaskSheetIds = new Set();
  for (const wl of workLogBlockerRows || []) {
    if (wl.source_type === 'task_sheet' && wl.source_id) {
      loggedTaskSheetIds.add(Number(wl.source_id));
    }
    pushBlocker(
      wl.project_id,
      {
        kind: 'work_log',
        source: wl.employee_name,
        date: wl.work_date,
        text: `${wl.employee_name} (${wl.work_date}): ${String(wl.blocker_text).trim()}`,
      },
      `wl:${wl.employee_name}:${String(wl.blocker_text).trim().toLowerCase()}`
    );
  }

  const projectByNameLower = new Map();
  const projectByKeyLower = new Map();
  for (const p of projects) {
    if (p.name) projectByNameLower.set(String(p.name).trim().toLowerCase(), Number(p.id));
    if (p.key) projectByKeyLower.set(String(p.key).trim().toLowerCase(), Number(p.id));
  }

  for (const ts of taskSheetBlockerRows || []) {
    if (loggedTaskSheetIds.has(Number(ts.id))) continue;
    let targetPid = ts.linked_project_id ? Number(ts.linked_project_id) : null;
    if (!targetPid && ts.project) {
      const pClean = String(ts.project).trim().toLowerCase();
      targetPid = projectByNameLower.get(pClean) || projectByKeyLower.get(pClean) || null;
    }
    if (!targetPid) continue;
    const dateStr = (ts.created_at || '').slice(0, 10);
    pushBlocker(
      targetPid,
      {
        kind: 'task_sheet',
        source: ts.name,
        date: dateStr,
        text: `${ts.name} (${dateStr}): ${String(ts.blocker).trim()}`,
      },
      `ts:${ts.name}:${String(ts.blocker).trim().toLowerCase()}`
    );
  }

  let generatedCount = 0;
  let missingCount = 0;

  const items = projects.map((p) => {
    const pid = Number(p.id);
    const agg = aggByProject.get(pid) || {};
    const total = Number(agg.total || 0);
    const open = Number(agg.c_open || 0);
    const inProgress = Number(agg.c_in_progress || 0);
    const resolved = Number(agg.c_resolved || 0);
    const closed = Number(agg.c_closed || 0);
    const overdue = Number(agg.c_overdue || 0);
    const urgent = Number(agg.c_urgent || 0);
    const completed = resolved + closed;
    const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

    const cached = summaryByProject.get(pid) || null;
    if (cached) generatedCount += 1;
    else missingCount += 1;

    const recordedBlockers = blockersByProject.get(pid) || [];
    const aiRisks = cached
      ? (cached.activeBlockers?.length ? cached.activeBlockers : cached.blockers) || []
      : [];

    const fallbackHealth =
      total > 0 && open === 0 && inProgress === 0
        ? 'completed'
        : overdue > 3 || urgent > 2
          ? 'critical'
          : overdue > 0 || recordedBlockers.length > 0
            ? 'at_risk'
            : 'on_track';

    let isStale = false;
    if (cached?.updatedAt && agg.latest_ticket_updated_at) {
      const summaryTime = new Date(cached.updatedAt).getTime();
      const ticketTime = new Date(String(agg.latest_ticket_updated_at).replace(' ', 'T') + (String(agg.latest_ticket_updated_at).includes('T') || String(agg.latest_ticket_updated_at).includes('Z') ? '' : 'Z')).getTime();
      if (!Number.isNaN(summaryTime) && !Number.isNaN(ticketTime) && ticketTime > summaryTime) {
        isStale = true;
      }
    }

    return {
      project: {
        id: pid,
        key: p.key,
        name: p.name,
        description: p.description || '',
        color: p.color || '#0c66e4',
        status: p.status || 'active',
        targetEndDate: p.target_end_date || null,
      },
      counts: {
        total,
        open: open + inProgress,
        todo: open,
        inProgress,
        resolved,
        closed,
        overdue,
        urgent,
        completionRate,
      },
      healthStatus: cached?.healthStatus || fallbackHealth,
      recordedBlockers,
      aiRisks,
      summary: cached,
      isStale,
      canRegenerate: canUserGenerateSummary(user),
    };
  });

  return {
    projects: items,
    generatedCount,
    missingCount,
  };
}
