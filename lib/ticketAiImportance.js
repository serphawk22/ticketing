import { db } from './db.js';
import { getTicket } from './tickets.js';

// Currently supported Google Gemini models (Gemini 3.5 Flash primary, with fast stable fallbacks)
const GEMINI_MODELS = ['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-flash-lite-latest'];

/**
 * Validates and normalizes an importance level string
 */
export function normalizeImportanceLevel(value) {
  const norm = String(value || '').trim().toLowerCase();
  if (['critical', 'high', 'medium', 'low'].includes(norm)) {
    return norm;
  }
  return null;
}

/**
 * Capitalizes importance level for presentation
 */
export function formatImportanceLabel(value) {
  const norm = normalizeImportanceLevel(value);
  if (!norm) return 'Not Assessed';
  return norm.charAt(0).toUpperCase() + norm.slice(1);
}

/**
 * Determines whether a ticket's AI importance analysis is stale
 * because other tickets in the same project have been created or modified
 * since the last analysis run.
 */
export async function checkAiImportanceIsStale(ticket) {
  if (!ticket || !ticket.project_id || !ticket.ai_importance_analyzed_at) {
    return false;
  }
  if (ticket.ai_importance_status !== 'analyzed') {
    return false;
  }

  try {
    const row = await db
      .prepare(
        `SELECT COUNT(*) AS c
         FROM tickets
         WHERE project_id = ?
           AND id != ?
           AND archived = 0
           AND updated_at > ?`
      )
      .get(ticket.project_id, ticket.id, ticket.ai_importance_analyzed_at);

    return Number(row?.c || 0) > 0;
  } catch (err) {
    console.error('[ai-importance:stale-check] Error:', err);
    return false;
  }
}

/**
 * Logs a human importance change to ticket_human_importance_history
 */
export async function logHumanImportanceChange({
  ticketId,
  oldValue,
  newValue,
  reason,
  userId,
  userName,
}) {
  const tId = Number(ticketId);
  const cleanReason = String(reason || '').trim();
  const cleanOld = oldValue ? normalizeImportanceLevel(oldValue) : null;
  const cleanNew = normalizeImportanceLevel(newValue) || 'medium';

  await db
    .prepare(
      `INSERT INTO ticket_human_importance_history
         (ticket_id, old_value, new_value, reason, changed_by, changed_by_name)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      tId,
      cleanOld,
      cleanNew,
      cleanReason || 'Updated importance',
      userId || null,
      userName || 'Authorized User'
    );
}

/**
 * Retrieves human importance change history for a ticket
 */
export async function getHumanImportanceHistory(ticketId) {
  const tId = Number(ticketId);
  return db
    .prepare(
      `SELECT id, ticket_id, old_value, new_value, reason, changed_by, changed_by_name, created_at
       FROM ticket_human_importance_history
       WHERE ticket_id = ?
       ORDER BY id DESC`
    )
    .all(tId);
}

/**
 * Retrieves AI importance analysis history for a ticket
 */
export async function getAiImportanceHistory(ticketId, limit = 10) {
  const tId = Number(ticketId);
  return db
    .prepare(
      `SELECT id, ticket_id, ai_importance, score, explanation, suggested_rank, total_tickets, status, analyzed_at, created_at
       FROM ticket_ai_importance_history
       WHERE ticket_id = ?
       ORDER BY id DESC
       LIMIT ?`
    )
    .all(tId, Number(limit) || 10);
}

/**
 * Calls Google Gemini REST endpoint securely with AI_API_KEY
 */
async function callGemini(apiKey, prompt) {
  let lastError = null;

  for (const model of GEMINI_MODELS) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 28000);

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.2,
            maxOutputTokens: 2048,
          },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        let errSnippet = '';
        try {
          const errJson = await res.json();
          errSnippet = errJson?.error?.message || '';
        } catch {
          const errText = await res.text();
          errSnippet = errText.slice(0, 200);
        }

        // Specific HTTP status handling
        if (res.status === 401 || res.status === 403) {
          throw new Error('Google Gemini API authentication failed. Please verify that AI_API_KEY in .env is a valid Gemini API key.');
        }
        if (res.status === 429) {
          throw new Error('Google Gemini API quota exceeded or rate limit reached. Please check your Gemini API plan.');
        }
        if (res.status === 404 || res.status === 503) {
          lastError = new Error(`Gemini model ${model} unavailable (${res.status}): ${errSnippet || 'Service unavailable'}. Trying fallback model...`);
          continue;
        }

        throw new Error(`Google Gemini API error (${res.status}): ${errSnippet}`);
      }

      const data = await res.json();
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) throw new Error('Empty response from Google Gemini API.');

      const cleanJson = rawText.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleanJson);
      return { parsed, model };
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.message?.includes('authentication failed') || err.message?.includes('quota exceeded')) {
        throw err;
      }
      if (err.name === 'AbortError') {
        lastError = new Error(`Gemini model ${model} request timed out.`);
        continue;
      }
      lastError = err;
      if (model === GEMINI_MODELS[GEMINI_MODELS.length - 1]) throw err;
    }
  }

  throw lastError || new Error('All Gemini candidate models failed to respond.');
}

/**
 * Requests AI evaluation from the official Google Gemini API
 */
async function requestAiEvaluation(apiKey, prompt) {
  const trimmedKey = String(apiKey || '').trim();
  if (!trimmedKey) {
    throw new Error('AI_API_KEY is not configured in the environment.');
  }
  return await callGemini(trimmedKey, prompt);
}

/**
 * Executes Project-Aware AI Importance Analysis for a ticket.
 *
 * Requirements:
 * 1. Read process.env.AI_API_KEY securely.
 * 2. If key missing, set status to 'unavailable' without generating fake scores.
 * 3. If key present, compare target ticket against all tickets in the same project.
 * 4. Generate AI score (0-100), classification (Critical/High/Medium/Low),
 *    short explanation, and Suggested Execution Rank (e.g., 1 of 25).
 * 5. If no project, analyze individual context and note comparison unavailable.
 * 6. Preserve previous AI result if re-analysis fails.
 */
export async function analyzeTicketAiImportance({ ticketId, force = false }) {
  const id = Number(ticketId);
  const ticket = await getTicket(id);
  if (!ticket) {
    throw new Error('Ticket not found.');
  }

  const apiKey = process.env.AI_API_KEY ? String(process.env.AI_API_KEY).trim() : '';

  // 1. Missing API Key: Do not generate fake scores or heuristic fallbacks
  if (!apiKey) {
    const explanation =
      'AI Analysis Unavailable. Set AI_API_KEY in environment variables to enable project-aware AI analysis.';
    await db
      .prepare(
        `UPDATE tickets
         SET ai_importance = NULL,
             ai_importance_score = NULL,
             ai_importance_explanation = ?,
             ai_importance_rank = NULL,
             ai_importance_total = NULL,
             ai_importance_status = 'unavailable',
             ai_importance_analyzed_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .run(explanation, id);

    return {
      status: 'unavailable',
      aiImportance: null,
      score: null,
      explanation,
      suggestedRank: null,
      totalTickets: null,
      analyzedAt: new Date().toISOString(),
    };
  }

  // 2. Fetch project context and comparison tickets
  const projectId = ticket.project_id ? Number(ticket.project_id) : null;
  let project = null;
  let projectTickets = [];
  let relations = [];

  if (projectId) {
    try {
      project = await db.prepare('SELECT id, key, name, description FROM projects WHERE id = ?').get(projectId);
      projectTickets = await db
        .prepare(
          `SELECT t.id, t.title, t.description, t.status, t.priority, t.human_importance, t.type,
                  t.due_date, t.employee_id, e.name AS employee_name
           FROM tickets t
           LEFT JOIN employees e ON e.id = t.employee_id
           WHERE t.project_id = ? AND t.archived = 0
           ORDER BY t.id ASC`
        )
        .all(projectId);

      relations = await db
        .prepare(
          `SELECT r.ticket_id, r.related_ticket_id, r.relation_type
           FROM ticket_relations r
           WHERE r.ticket_id = ? OR r.related_ticket_id = ?`
        )
        .all(id, id);
    } catch (err) {
      console.error('[ai-importance:context-fetch] Error:', err);
    }
  }

  const totalTicketsCount = projectTickets.length || 1;
  const projectKey = project?.key || ticket.project_key || 'TM';
  const targetKey = `${projectKey}-${ticket.id}`;

  const blockingOutgoing = relations
    .filter((r) => r.ticket_id === id && (r.relation_type === 'blocks' || r.relation_type === 'parent_of'))
    .map((r) => `${projectKey}-${r.related_ticket_id}`);

  const blockedByIncoming = relations
    .filter((r) => r.related_ticket_id === id && r.relation_type === 'blocks')
    .map((r) => `${projectKey}-${r.ticket_id}`);

  const relationsDescription = [
    blockingOutgoing.length ? `Blocks: ${blockingOutgoing.join(', ')}` : null,
    blockedByIncoming.length ? `Is blocked by: ${blockedByIncoming.join(', ')}` : null,
  ]
    .filter(Boolean)
    .join('; ') || 'No blocking dependencies detected';

  // 3. Build comparative prompt
  let prompt = '';
  if (projectId && project) {
    const otherTicketsSummary = projectTickets
      .map((t) => {
        const isTarget = t.id === id;
        const tKey = `${projectKey}-${t.id}`;
        return `[${tKey}] Title: "${t.title}" | Status: ${t.status} | Priority: ${t.priority} | Human Importance: ${t.human_importance || 'Not specified'} | Due: ${t.due_date || 'None'} | Assignee: ${t.employee_name || 'Unassigned'}${isTarget ? ' <--- TARGET TICKET UNDER EVALUATION' : ''}`;
      })
      .join('\n');

    prompt = `You are an expert technical project management AI and prioritization auditor.

EVALUATION TASK:
Analyze the TARGET TICKET within the context of its ENTIRE PROJECT and evaluate its relative importance, business impact, technical urgency, dependencies, blockers, and execution order compared against all other active tickets in this same project.

PROJECT CONTEXT:
- Project: "${project.name}" (${project.key})
- Description: ${project.description || 'None provided'}
- Total Active Project Tickets: ${projectTickets.length}

TARGET TICKET TO EVALUATE:
- Key: ${targetKey}
- Title: "${ticket.title}"
- Description: "${ticket.description || 'No description provided'}"
- Current Priority: ${ticket.priority}
- Human Importance: ${ticket.human_importance || 'Not specified'}
- Issue Type: ${ticket.type}
- Status: ${ticket.status}
- Due Date: ${ticket.due_date || 'None'}
- Dependencies / Relations: ${relationsDescription}

ALL ACTIVE TICKETS IN THIS PROJECT (FOR DIRECT COMPARISON):
${otherTicketsSummary}

EVALUATION RULES:
1. Compare this target ticket directly with every other ticket in the project above.
2. Consider business & client impact, technical urgency, dependencies (e.g. blocking other work), deadlines, operational risks, and which tickets should be executed first.
3. Human Importance is a team signal to consider, but do NOT simply mirror or copy it. Form your own independent assessment based on the project-wide workload.
4. Do NOT invent dependencies, blockers, or business impact that are not supported by the available data.
5. Provide a Suggested Execution Rank from 1 to ${projectTickets.length} (1 being the highest priority ticket to execute first across the entire project).
6. Provide an AI Importance Score from 0 to 100.
7. Classify AI Importance as strictly one of: "Critical", "High", "Medium", "Low".
8. Provide maximum 3 to 4 short, meaningful bullet points in "key_reasons" highlighting ONLY the critical drivers for this importance (e.g. blockers, deadlines, business impact). Avoid long paragraphs, excessive text, and generic filler. Keep each line under 16 words.

RESPONSE FORMAT (JSON ONLY, NO MARKDOWN, NO CODEBLOCKS):
{
  "ai_importance": "Critical" | "High" | "Medium" | "Low",
  "score": 0-100,
  "suggested_rank": 1-${projectTickets.length},
  "total_tickets": ${projectTickets.length},
  "key_reasons": [
    "Concise key reason 1",
    "Concise key reason 2",
    "Concise key reason 3"
  ]
}`;
  } else {
    // Ticket without an assigned project
    prompt = `You are an expert technical project management AI and prioritization auditor.

EVALUATION TASK:
Analyze this standalone ticket. Note that this ticket has NO assigned project, so project-wide comparison is unavailable.

TICKET DETAILS:
- Title: "${ticket.title}"
- Description: "${ticket.description || 'No description provided'}"
- Priority: ${ticket.priority}
- Human Importance: ${ticket.human_importance || 'Not specified'}
- Issue Type: ${ticket.type}
- Status: ${ticket.status}
- Due Date: ${ticket.due_date || 'None'}

EVALUATION RULES:
1. Evaluate based on individual ticket context.
2. Human Importance is a team signal to consider, but do NOT simply mirror it.
3. Classify AI Importance as strictly one of: "Critical", "High", "Medium", "Low".
4. Score from 0 to 100.
5. Since no project is assigned, suggested_rank MUST be null, and total_tickets MUST be 1.
6. Provide 2-3 short, meaningful bullet points in "key_reasons". Note that project ranking is unavailable.

RESPONSE FORMAT (JSON ONLY):
{
  "ai_importance": "Critical" | "High" | "Medium" | "Low",
  "score": 0-100,
  "suggested_rank": null,
  "total_tickets": 1,
  "key_reasons": [
    "Assessed individually based on priority and due date",
    "Standalone item: project-wide comparative ranking unavailable"
  ]
}`;
  }

  // 4. Request evaluation from official Google Gemini API
  try {
    const { parsed: aiResponse, model: usedModel } = await requestAiEvaluation(apiKey, prompt);

    const rawImportance = String(aiResponse?.ai_importance || '').trim().toLowerCase();
    const normalizedImportance = ['critical', 'high', 'medium', 'low'].includes(rawImportance)
      ? rawImportance
      : 'medium';

    const rawScore = Number(aiResponse?.score);
    const score = Number.isFinite(rawScore) ? Math.min(100, Math.max(0, Math.round(rawScore))) : 50;

    let rank = null;
    if (projectId && aiResponse?.suggested_rank != null) {
      const parsedRank = parseInt(aiResponse.suggested_rank, 10);
      if (Number.isInteger(parsedRank) && parsedRank >= 1) {
        rank = Math.min(parsedRank, totalTicketsCount);
      }
    }

    // Extract max 4-5 concise, meaningful lines
    let keyReasons = [];
    if (Array.isArray(aiResponse?.key_reasons) && aiResponse.key_reasons.length > 0) {
      keyReasons = aiResponse.key_reasons
        .map((r) => String(r).replace(/^[•\-\*\d\.]+\s*/, '').trim())
        .filter(Boolean)
        .slice(0, 5);
    } else if (typeof aiResponse?.explanation === 'string') {
      keyReasons = aiResponse.explanation
        .split(/\n|•|\r/)
        .map((s) => s.replace(/^[•\-\*\d\.]+\s*/, '').trim())
        .filter((s) => s.length > 3)
        .slice(0, 5);
    }
    if (!keyReasons.length) {
      keyReasons = ['Assessed workload impact and deadlines relative to project milestones.'];
    }

    const explanation = keyReasons.map((r) => `• ${r}`).join('\n');

    // Save to database
    await db
      .prepare(
        `UPDATE tickets
         SET ai_importance = ?,
             ai_importance_score = ?,
             ai_importance_explanation = ?,
             ai_importance_rank = ?,
             ai_importance_total = ?,
             ai_importance_status = 'analyzed',
             ai_importance_analyzed_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .run(normalizedImportance, score, explanation, rank, totalTicketsCount, id);

    // Record in AI analysis history
    await db
      .prepare(
        `INSERT INTO ticket_ai_importance_history
           (ticket_id, ai_importance, score, explanation, suggested_rank, total_tickets, status, analyzed_at)
         VALUES (?, ?, ?, ?, ?, ?, 'analyzed', CURRENT_TIMESTAMP)`
      )
      .run(id, normalizedImportance, score, explanation, rank, totalTicketsCount);

    return {
      status: 'analyzed',
      aiImportance: normalizedImportance,
      score,
      explanation,
      suggestedRank: rank,
      totalTickets: totalTicketsCount,
      analyzedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.error(`[ai-importance:analyze] Ticket #${id} analysis failed:`, err.message);

    // If previously analyzed, preserve the previous result
    if (ticket.ai_importance_status === 'analyzed' && ticket.ai_importance) {
      await db
        .prepare(
          `INSERT INTO ticket_ai_importance_history
             (ticket_id, ai_importance, score, explanation, suggested_rank, total_tickets, status, analyzed_at)
           VALUES (?, ?, ?, ?, ?, ?, 'failed', CURRENT_TIMESTAMP)`
        )
        .run(
          id,
          ticket.ai_importance,
          ticket.ai_importance_score,
          `Re-analysis attempt failed: ${err.message}`,
          ticket.ai_importance_rank,
          ticket.ai_importance_total
        );

      return {
        status: 'analyzed',
        aiImportance: ticket.ai_importance,
        score: ticket.ai_importance_score,
        explanation: ticket.ai_importance_explanation,
        suggestedRank: ticket.ai_importance_rank,
        totalTickets: ticket.ai_importance_total,
        analyzedAt: ticket.ai_importance_analyzed_at,
        error: `Re-analysis failed: ${err.message}. Previous analysis preserved.`,
      };
    }

    // No prior result: record failure without breaking ticket
    const failExplanation = `AI analysis could not be completed: ${err.message}`;
    await db
      .prepare(
        `UPDATE tickets
         SET ai_importance_status = 'failed',
             ai_importance_explanation = ?,
             ai_importance_analyzed_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .run(failExplanation, id);

    await db
      .prepare(
        `INSERT INTO ticket_ai_importance_history
           (ticket_id, ai_importance, score, explanation, suggested_rank, total_tickets, status, analyzed_at)
         VALUES (?, NULL, NULL, ?, NULL, NULL, 'failed', CURRENT_TIMESTAMP)`
      )
      .run(id, failExplanation);

    return {
      status: 'failed',
      aiImportance: null,
      score: null,
      explanation: failExplanation,
      suggestedRank: null,
      totalTickets: null,
      analyzedAt: new Date().toISOString(),
      error: err.message,
    };
  }
}

