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

  const achievements = Array.isArray(rawJson.achievements)
    ? rawJson.achievements.map((item) => String(item).trim()).filter(Boolean)
    : [];

  const blockers = Array.isArray(rawJson.blockers)
    ? rawJson.blockers.map((item) => String(item).trim()).filter(Boolean)
    : [];

  const recommendations = Array.isArray(rawJson.recommendations)
    ? rawJson.recommendations.map((item) => String(item).trim()).filter(Boolean)
    : [];

  return {
    healthStatus,
    headline,
    summaryText,
    achievements: achievements.slice(0, 5),
    blockers: blockers.slice(0, 5),
    recommendations: recommendations.slice(0, 5),
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

  const { scopeType, projectName, projectKey, projectDescription, metrics, activeBlockers, criticalTickets } = verifiedMetrics;

  const prompt = `
You are an executive project management auditor.
Analyze the following verified database metrics for ${scopeType === 'overall' ? 'the entire organization' : `the project "${projectName}" (${projectKey})`}.

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

CRITICAL & OVERDUE TICKETS RECORDED:
${criticalTickets.length ? criticalTickets.map((t) => `  * [${t.key}] ${t.title} (Priority: ${t.priority}, Status: ${t.status}, Due: ${t.dueDate}, Assignee: ${t.assignee})`).join('\n') : '  None'}

STANDUP / TASK SHEET BLOCKERS RECORDED:
${activeBlockers.length ? activeBlockers.map((b) => `  * [${b.date || 'Recent'}] (${b.source}): ${b.text}`).join('\n') : '  No recent standup blockers recorded'}

RULES:
1. Grounding: Rely strictly on the numbers and tickets provided. DO NOT fabricate ticket keys, percentages, or events not present in the metrics.
2. Health Status determination:
   - "completed": If 100% of tickets are resolved/closed and total > 0.
   - "critical": If overdue tickets > 3 or urgent tickets > 2 with low velocity.
   - "at_risk": If overdue tickets > 0 or unassigned work is high (>25% of total).
   - "on_track": Healthy completion rate and no severe blockers.
3. Output MUST be a valid JSON object matching the schema below:
{
  "health_status": "on_track" | "at_risk" | "critical" | "completed",
  "headline": "A sharp, executive 1-sentence assessment summarizing health and velocity",
  "summary_text": "2 concise paragraphs synthesizing the project trajectory, throughput, and status distribution based on the numbers.",
  "achievements": [
    "Highlight completed velocity, milestone progress, or resolved items"
  ],
  "blockers": [
    "Specific risks derived from overdue items, urgent tasks, or recorded standup blockers"
  ],
  "recommendations": [
    "Actionable next steps for the project manager to improve delivery"
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
    const timeoutId = setTimeout(() => controller.abort(), 35000); // 35s timeout per candidate

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
