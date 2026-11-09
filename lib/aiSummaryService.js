import { db } from './db.js';
import { getVerifiedProjectMetrics } from './aiDataAggregator.js';
import { generateOpenAiProgressSummary } from './aiOpenAI.js';
import { generateGeminiProgressSummary } from './aiGemini.js';
import { getProject } from './projects.js';

/**
 * Checks if a user has authorization to view the summary for a given scope
 */
export async function canUserAccessScope(user, scopeType, projectId) {
  if (!user) return false;
  if (user.role === 'admin') return true;

  if (scopeType === 'overall') {
    // Only internal team members (admin & developer) can see overall organization metrics
    return user.role === 'developer';
  }

  // Project-specific check
  const numericId = Number(projectId);
  if (!numericId) return false;

  const project = await getProject(numericId);
  if (!project) return false;

  if (user.role === 'client') {
    // Clients only see projects they explicitly own
    return project.client_id === user.id;
  }

  // Developer internal role
  return true;
}

/**
 * Checks if a user has authorization to generate/regenerate an AI summary
 */
export function canUserGenerateSummary(user) {
  if (!user) return false;
  // Clients are read-only; internal team members can regenerate
  return user.role === 'admin' || user.role === 'developer';
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
  const metricsStr = JSON.stringify(verifiedMetrics.metrics || {});

  // Check if row already exists
  let existingQuery = isOverall
    ? 'SELECT id FROM ai_progress_summaries WHERE scope_type = \'overall\' AND project_id IS NULL'
    : 'SELECT id FROM ai_progress_summaries WHERE scope_type = \'project\' AND project_id = ?';
  const existingParams = isOverall ? [] : [numericId];
  const existingRow = await db.prepare(existingQuery).get(...existingParams);

  if (existingRow?.id) {
    // Update in-place
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
    // Insert new record
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
}
