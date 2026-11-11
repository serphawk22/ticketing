/**
 * Google Gemini API Client
 * Uses native fetch (Node 20+) to generate structured progress summaries.
 * Server-side only; never exposes GEMINI_API_KEY to the client.
 */

const DEFAULT_MODELS = ['gemini-3.5-flash', 'gemini-3-flash-preview', 'gemini-3.8-flash', 'gemini-1.5-flash'];

/**
 * Validates and normalizes structured response from the LLM
 */
function validateAndCleanResponse(rawJson, activeModel) {
  const validHealth = ['on_track', 'at_risk', 'critical', 'completed'];
  const healthStatus = validHealth.includes(rawJson.health_status) ? rawJson.health_status : 'on_track';
  const headline = typeof rawJson.headline === 'string' && rawJson.headline.trim()
    ? rawJson.headline.trim()
    : 'Executive Progress Review';

  const summaryText = typeof rawJson.summary_text === 'string' && rawJson.summary_text.trim()
    ? rawJson.summary_text.trim()
    : 'Progress is proceeding according to recorded ticket milestones.';

  const cleanList = (arr, limit = 8) =>
    Array.isArray(arr)
      ? arr.map((item) => String(item).trim()).filter(Boolean).slice(0, limit)
      : [];

  const recentAchievements = cleanList(rawJson.recent_achievements || rawJson.achievements);
  const historicalAchievements = cleanList(rawJson.historical_achievements);
  const currentDevelopment = cleanList(rawJson.current_development);
  const blockers = cleanList(rawJson.active_blockers || rawJson.blockers);
  const upcomingWork = cleanList(rawJson.upcoming_work);
  const dependencies = cleanList(rawJson.dependencies);
  const recommendations = cleanList(rawJson.recommendations);

  // Backward-compatible achievements list for existing components
  const achievements = recentAchievements.length > 0 ? recentAchievements : historicalAchievements;

  return {
    healthStatus,
    headline,
    summaryText,
    achievements,
    blockers,
    recommendations,
    historicalAchievements,
    recentAchievements,
    currentDevelopment,
    upcomingWork,
    dependencies,
    modelName: activeModel,
  };
}

/**
 * Generates an executive progress review using Gemini with automatic model fallback
 *
 * @param {object} verifiedMetrics - Ground-truth metrics computed directly by backend SQL
 * @returns {Promise<{
 *   healthStatus: 'on_track' | 'at_risk' | 'critical' | 'completed',
 *   headline: string,
 *   summaryText: string,
 *   achievements: string[],
 *   blockers: string[],
 *   recommendations: string[],
 *   historicalAchievements: string[],
 *   recentAchievements: string[],
 *   currentDevelopment: string[],
 *   upcomingWork: string[],
 *   dependencies: string[],
 *   modelName: string
 * }>}
 */
export async function generateGeminiProgressSummary(verifiedMetrics) {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not configured in the server environment (.env). Please add a valid Gemini API key.'
    );
  }

  const {
    scopeType,
    projectName,
    projectKey,
    projectDescription,
    metrics,
    activeBlockers,
    criticalTickets,
    ticketsDigest,
  } = verifiedMetrics;

  const prompt = `
You are a principal technical project auditor and agile delivery director.
Analyze the following verified database metrics and comprehensive ticket intelligence digest for ${
    scopeType === 'overall' ? 'the entire organization' : `the project "${projectName}" (${projectKey})`
  }.
Perform a thorough, combined read-through of ticket descriptions, comments, updates, and resolutions.

VERIFIED DATABASE METRICS (TRUTH - DO NOT INVENT NUMBERS OR CHANGE THESE VALUES):
- Scope: ${scopeType}
- Target: ${projectName} (${projectKey})
${projectDescription ? `- Description: ${projectDescription}` : ''}
- Total Work Items: ${metrics.total}
- Status Breakdown:
  * Open: ${metrics.byStatus.open}
  * In Progress: ${metrics.byStatus.in_progress}
  * Resolved: ${metrics.byStatus.resolved}
  * Closed: ${metrics.byStatus.closed}
- Completion Rate: ${metrics.completionRate}% (${metrics.byStatus.resolved + metrics.byStatus.closed} of ${metrics.total} completed)
- Priority Breakdown:
  * Urgent: ${metrics.byPriority.urgent}
  * High: ${metrics.byPriority.high}
  * Medium: ${metrics.byPriority.medium}
  * Low: ${metrics.byPriority.low}
- Overdue Tickets: ${metrics.overdueCount}
- Unassigned Work Items: ${metrics.unassignedCount}
- Recent Velocity (Last 14 days):
  * Created: ${metrics.recentCreated}
  * Completed: ${metrics.recentCompleted}
- Total Logged Effort: ${metrics.totalLoggedHours} hours

STANDUP / TASK SHEET BLOCKERS RECORDED:
${activeBlockers.length ? activeBlockers.map((b) => `  * [${b.date || 'Recent'}] (${b.source}): ${b.text}`).join('\n') : '  No recent standup blockers recorded'}

PROJECT TICKETS COMBINED INTELLIGENCE DIGEST:
${ticketsDigest?.digestText || 'No tickets recorded.'}

RULES:
1. Grounding & Evidence: Rely strictly on the verified numbers, tickets, descriptions, and comments provided. Always cite the exact ticket key (e.g. [${projectKey || 'TM'}-12]) when referencing work items, features, bugs, or blockers. NEVER fabricate ticket IDs, statistics, or progress percentages.
2. Distinguish Work Stages:
   - Historical achievements: Foundational milestones resolved/closed in earlier periods.
   - Recent achievements: Deliverables resolved or closed in the current sprint cycle (last 14 days).
   - Current development: What developers are actively coding/implementing right now (in-progress tickets).
   - Active blockers & risks: Confirmed impediments from ticket descriptions, relations, or comments.
   - Upcoming work: High-priority items queued in the open backlog.
   - Dependencies: Cross-ticket blocking relationships.
3. Health Status determination:
   - "completed": If 100% of tickets are resolved/closed and total > 0.
   - "critical": If overdue tickets > 3 or urgent tickets > 2 with low velocity or severe blockers.
   - "at_risk": If overdue tickets > 0 or unassigned work is high (>25%) or active dependencies are blocked.
   - "on_track": Healthy completion velocity and no critical blockers.
4. Output MUST be a strictly valid JSON object matching the schema below:
{
  "health_status": "on_track" | "at_risk" | "critical" | "completed",
  "headline": "A sharp, executive 1-sentence assessment summarizing velocity, health, and primary focus.",
  "summary_text": "2 concise paragraphs synthesizing what the team is building, major achievements, throughput trajectory, and risk posture based on the tickets read-through.",
  "historical_achievements": [
    "Citing [KEY-ID] foundational completed features from earlier periods"
  ],
  "recent_achievements": [
    "Citing [KEY-ID] specific completed deliverables resolved/closed in the last 14 days"
  ],
  "current_development": [
    "Citing [KEY-ID] specific tasks currently in progress and what developers are actively building"
  ],
  "active_blockers": [
    "Citing [KEY-ID] specific technical blockers, delays, or risk factors"
  ],
  "upcoming_work": [
    "Citing [KEY-ID] next high-priority planned items from backlog"
  ],
  "dependencies": [
    "Citing [KEY-A] and [KEY-B] cross-ticket blockers or external prerequisites"
  ],
  "recommendations": [
    "Actionable, pragmatic recommendations for the project manager to improve delivery velocity"
  ]
}
`.trim();

  // Determine candidate models list (user configured env > gemini-3.8-flash > fallbacks)
  const userModel = (process.env.GEMINI_MODEL || '').trim();
  const candidateModels = Array.from(new Set([userModel, ...DEFAULT_MODELS].filter(Boolean)));

  let lastError = null;

  for (const model of candidateModels) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000); // 45s timeout per candidate

    try {
      const res = await fetch(`${endpoint}?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.2,
            maxOutputTokens: 4096,
            thinkingConfig: {
              thinkingBudget: 0,
            },
          },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        const errText = await res.text();
        let parsedError = '';
        try {
          const errorJson = JSON.parse(errText);
          parsedError = errorJson.error?.message || errText;
        } catch {
          parsedError = errText;
        }

        // If 404 (model not found/available) or 503, try next candidate
        if (res.status === 404 || res.status === 503) {
          lastError = new Error(`Gemini model ${model} unavailable (${res.status}): ${parsedError}`);
          continue;
        }

        throw new Error(`Gemini API error (${res.status}): ${parsedError}`);
      }

      const data = await res.json();
      const candidateText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!candidateText) {
        throw new Error('Gemini API returned an empty response candidate.');
      }

      let parsedJson;
      try {
        parsedJson = JSON.parse(candidateText);
      } catch {
        const cleaned = candidateText.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
        parsedJson = JSON.parse(cleaned);
      }

      return validateAndCleanResponse(parsedJson, model);
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        lastError = new Error(`Gemini model ${model} timed out. Trying fallback model...`);
        continue;
      }
      if (err.message && (err.message.includes('(404)') || err.message.includes('(503)'))) {
        lastError = err;
        continue;
      }
      throw err;
    }
  }

  throw lastError || new Error('All Gemini candidate models failed to respond.');
}
