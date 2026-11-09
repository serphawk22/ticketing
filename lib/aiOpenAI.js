/**
 * OpenAI API Client
 * Uses native fetch (Node 20+) to generate structured progress summaries.
 * Server-side only; never exposes OPENAI_API_KEY to the client.
 */

const DEFAULT_MODEL = 'gpt-4o-mini';
const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions';

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
 * Generates an executive progress review using OpenAI API
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
export async function generateOpenAiProgressSummary(verifiedMetrics) {
  const apiKey = (process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error(
      'OPENAI_API_KEY is not configured in the server environment (.env). Please add your OpenAI API key.'
    );
  }

  const model = (process.env.OPENAI_MODEL || DEFAULT_MODEL).trim();
  const { scopeType, projectName, projectKey, projectDescription, metrics, activeBlockers, criticalTickets } = verifiedMetrics;

  const systemPrompt = `You are an executive project management auditor.
Analyze the provided verified database metrics and produce an executive progress review.
RULES:
1. Rely strictly on the numbers, counts, and tickets provided. DO NOT fabricate ticket keys, percentages, or events not present in the metrics.
2. Health Status determination:
   - "completed": If 100% of tickets are resolved/closed and total > 0.
   - "critical": If overdue tickets > 3 or urgent tickets > 2 with low velocity.
   - "at_risk": If overdue tickets > 0 or unassigned work is high (>25% of total).
   - "on_track": Healthy completion rate and no severe blockers.
3. Output MUST be a strictly valid JSON object matching:
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
}`;

  const userPrompt = `
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
`.trim();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout

  try {
    const res = await fetch(OPENAI_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2,
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
      throw new Error(`OpenAI API error (${res.status}): ${parsedError}`);
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('OpenAI API returned an empty response content.');
    }

    let parsedJson;
    try {
      parsedJson = JSON.parse(content);
    } catch {
      const cleaned = content.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
      parsedJson = JSON.parse(cleaned);
    }

    return validateAndCleanResponse(parsedJson, model);
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error('OpenAI API request timed out after 30 seconds.');
    }
    throw err;
  }
}
