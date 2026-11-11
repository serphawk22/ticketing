import { db } from './db.js';
import { aggregateTaskSheetPulseMetrics, extractIstDate } from './taskSheetAiAggregator.js';
import { indiaToday } from './indiaDate.js';

const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
const DEFAULT_GEMINI_MODELS = ['gemini-3.5-flash', 'gemini-3-flash-preview', 'gemini-3.8-flash', 'gemini-1.5-flash'];

/**
 * Normalizes a database row into a structured summary object
 */
export function formatTaskSheetAiSummaryRow(row) {
  if (!row) return null;

  let comparisonDates = [];
  let metricsComparison = {};
  let memberInsights = [];
  let blockerAnalysis = { critical: [], recurring: [], affectedEmployees: [] };
  let projectShifts = [];
  let recommendations = [];

  try {
    comparisonDates = JSON.parse(row.comparison_dates_json || '[]');
  } catch {}
  try {
    metricsComparison = JSON.parse(row.metrics_comparison_json || '{}');
  } catch {}
  try {
    memberInsights = JSON.parse(row.member_insights_json || '[]');
  } catch {}
  try {
    blockerAnalysis = JSON.parse(row.blocker_analysis_json || '{}');
  } catch {}
  try {
    projectShifts = JSON.parse(row.project_shifts_json || '[]');
  } catch {}
  try {
    recommendations = JSON.parse(row.recommendations_json || '[]');
  } catch {}

  return {
    id: row.id,
    targetDate: row.target_date,
    lookbackDays: row.lookback_days,
    comparisonDates,
    headline: row.headline,
    executiveSummary: row.executive_summary,
    healthStatus: row.health_status,
    metricsComparison,
    memberInsights,
    blockerAnalysis,
    projectShifts,
    recommendations,
    modelName: row.model_name,
    generatedBy: row.generated_by,
    generatedByName: row.generated_by_name || 'Management',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Validates and normalizes structured response from the LLM against ground truth
 */
function validateAndCleanResponse(rawJson, activeModel, metrics) {
  const validHealth = ['high_momentum', 'steady', 'at_risk', 'critical'];
  const healthStatus = validHealth.includes(rawJson?.health_status)
    ? rawJson.health_status
    : metrics.teamSummary.activeBlockersCount > 2
    ? 'at_risk'
    : 'steady';

  const headline =
    typeof rawJson?.headline === 'string' && rawJson.headline.trim()
      ? rawJson.headline.trim()
      : 'Team Productivity Review';

  const executiveSummary =
    typeof rawJson?.executive_summary === 'string' && rawJson.executive_summary.trim()
      ? rawJson.executive_summary.trim()
      : 'Performance is moving along planned deliverables.';

  // Build a mapped lookup of member insights from AI
  const aiMemberMap = new Map();
  if (Array.isArray(rawJson?.member_insights)) {
    for (const item of rawJson.member_insights) {
      if (item?.name) {
        aiMemberMap.set(String(item.name).trim().toLowerCase(), item);
      }
    }
  }

  const validStatuses = [
    'High Velocity',
    'Steady',
    'Blocked / Needs Support',
    'Under-reported / Incomplete',
    'Pending Submission',
  ];

  // Align with every actual active employee from database
  const normalizedMembers = metrics.memberMatrix.map((emp) => {
    const aiInsight = aiMemberMap.get(emp.name.toLowerCase());
    let status = emp.status; // Start with verified DB status

    if (aiInsight?.status && validStatuses.includes(aiInsight.status)) {
      // Allow AI to classify high velocity or steady, but preserve pending/under-reported facts
      if (!emp.hasSubmitted) {
        status = 'Pending Submission';
      } else if (emp.todayHours === 0 && emp.todayCompletedTasks === 0 && emp.todayOpenTasks === 0) {
        status = 'Under-reported / Incomplete';
      } else {
        status = aiInsight.status;
      }
    }

    let observation = '';
    if (aiInsight?.observation && typeof aiInsight.observation === 'string') {
      observation = aiInsight.observation.trim();
    } else if (!emp.hasSubmitted) {
      observation = 'Has not submitted their daily task sheet for today.';
    } else if (emp.todayBlockers.length > 0) {
      observation = `Reported blocker: ${emp.todayBlockers[0]}`;
    } else if (emp.todayHours > 0) {
      observation = `Logged ${emp.todayHours}h across ${emp.todayCompletedTasks} completed tasks.`;
    } else {
      observation = 'Recorded submission with no logged hours.';
    }

    return {
      employeeId: emp.employeeId,
      name: emp.name,
      department: emp.department,
      title: emp.title,
      hasSubmitted: emp.hasSubmitted,
      todayHours: emp.todayHours,
      todayCompletedTasks: emp.todayCompletedTasks,
      todayOpenTasks: emp.todayOpenTasks,
      todayBlockers: emp.todayBlockers,
      histDailyAvgHours: emp.histDailyAvgHours,
      histDailyAvgCompleted: emp.histDailyAvgCompleted,
      status,
      observation,
    };
  });

  // Normalize project shifts
  const projectShifts = (metrics.projectDistribution || []).map((p) => {
    const aiShift = Array.isArray(rawJson?.project_shifts)
      ? rawJson.project_shifts.find((s) => s?.project?.toLowerCase() === p.project.toLowerCase())
      : null;

    return {
      project: p.project,
      todayHours: p.todayHours,
      histDailyAvgHours: p.histDailyAvgHours,
      deltaPct: p.deltaPct,
      status: p.status,
      observation:
        aiShift?.observation ||
        (p.status === 'increased_focus'
          ? `Effort increased by ${p.deltaPct}% compared to the 3-day average.`
          : p.status === 'decreased_focus'
          ? `Effort decreased by ${Math.abs(p.deltaPct)}% compared to the 3-day average.`
          : p.status === 'neglected'
          ? 'No hours logged today despite steady historical activity.'
          : 'Pacing evenly with historical baseline.'),
    };
  });

  // Blocker analysis
  const blockerAnalysis = {
    critical: Array.isArray(rawJson?.blocker_analysis?.critical)
      ? rawJson.blocker_analysis.critical.map(String).filter(Boolean)
      : metrics.todayBlockers.slice(0, 3).map((b) => `${b.employeeName} (${b.project}): ${b.blocker}`),
    recurring: Array.isArray(rawJson?.blocker_analysis?.recurring)
      ? rawJson.blocker_analysis.recurring.map(String).filter(Boolean)
      : metrics.recurringBlockers.slice(0, 3).map((b) => `${b.employeeName}: ${b.blocker}`),
    affectedEmployees: Array.isArray(rawJson?.blocker_analysis?.affected_employees)
      ? rawJson.blocker_analysis.affected_employees.map(String).filter(Boolean)
      : Array.from(new Set(metrics.todayBlockers.map((b) => b.employeeName))),
  };

  // Recommendations
  let recommendations = Array.isArray(rawJson?.recommendations)
    ? rawJson.recommendations.map(String).filter(Boolean)
    : [];

  if (recommendations.length < 3) {
    if (metrics.todayBlockers.length > 0) {
      recommendations.push(
        `Address reported blockers for ${blockerAnalysis.affectedEmployees.join(', ')} to prevent delivery slippage.`
      );
    }
    const pendingNames = normalizedMembers.filter((m) => !m.hasSubmitted).map((m) => m.name);
    if (pendingNames.length > 0) {
      recommendations.push(
        `Follow up with ${pendingNames.slice(0, 3).join(', ')}${pendingNames.length > 3 ? ' and others' : ''} to submit pending timesheets.`
      );
    }
    recommendations.push('Rebalance task load across team members to maintain even velocity.');
  }

  return {
    healthStatus,
    headline,
    executiveSummary,
    memberInsights: normalizedMembers,
    blockerAnalysis,
    projectShifts,
    recommendations: recommendations.slice(0, 4),
    modelName: activeModel,
  };
}

/**
 * Builds user prompt containing grounded data
 */
function buildTaskSheetAiPrompt(metrics) {
  const { targetDate, targetDateFormatted, comparisonDays, teamSummary, todayBlockers, recurringBlockers, projectDistribution, memberMatrix } = metrics;
  const compDatesFormatted = comparisonDays.map((d) => d.formatted).join(', ');

  return `
GROUND-TRUTH DATABASE METRICS (TRUTH - NEVER INVENT OR ALTER VALUES):
- Anchor Date (Today): ${targetDateFormatted} (${targetDate})
- Comparison Previous Working Days: ${compDatesFormatted} (${comparisonDays.length} working days, Sundays and company holidays excluded)
- Team Size: ${metrics.teamSize} active employees
- Participation: ${teamSummary.todayActiveCount} of ${metrics.teamSize} submitted (${teamSummary.submissionRate}%) vs ${teamSummary.histAvgSubmitters} historical daily average submitters
- Total Logged Hours: ${teamSummary.todayTotalHours}h today vs ${teamSummary.histDailyAvgHours}h historical daily average (${teamSummary.hoursDeltaPct >= 0 ? '+' : ''}${teamSummary.hoursDeltaPct}%)
- Tasks Completed: ${teamSummary.todayCompletedTasks} today vs ${teamSummary.histDailyAvgCompleted} historical daily average (${teamSummary.tasksDeltaPct >= 0 ? '+' : ''}${teamSummary.tasksDeltaPct}%)
- Tasks Open / In Progress: ${teamSummary.todayOpenTasks}
- Task Completion Rate: ${teamSummary.todayCompletionRate}% today vs ${teamSummary.histCompletionRate}% historical average
- Active Blockers Count: ${teamSummary.activeBlockersCount} (Recurring: ${teamSummary.recurringBlockersCount})

TODAY'S RECORDED BLOCKERS:
${todayBlockers.length ? todayBlockers.map((b) => `  * [${b.employeeName}] (${b.project}): ${b.blocker}`).join('\n') : '  None'}

RECURRING BLOCKERS IDENTIFIED:
${recurringBlockers.length ? recurringBlockers.map((b) => `  * [${b.employeeName}] (${b.project}): ${b.blocker}`).join('\n') : '  None'}

PROJECT EFFORT DISTRIBUTION:
${projectDistribution.length ? projectDistribution.map((p) => `  * ${p.project}: ${p.todayHours}h today vs ${p.histDailyAvgHours}h avg (${p.deltaPct >= 0 ? '+' : ''}${p.deltaPct}%) -> status: ${p.status}`).join('\n') : '  No project activity recorded'}

TEAM MEMBERS BREAKDOWN:
${memberMatrix.map((m) => `  * ${m.name} (${m.title || m.department || 'Team Member'}): Submitted: ${m.hasSubmitted ? 'YES' : 'NO'}, Today Hours: ${m.todayHours}h, Today Completed: ${m.todayCompletedTasks}, Today Open: ${m.todayOpenTasks}, Historical Avg Hours: ${m.histDailyAvgHours}h, Historical Avg Completed: ${m.histDailyAvgCompleted}, Blockers: ${m.todayBlockers.length ? m.todayBlockers.join('; ') : 'None'}`).join('\n')}
`.trim();
}

/**
 * Call OpenAI API
 */
async function callOpenAiPulse(metrics) {
  const apiKey = (process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured in .env');

  const model = (process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL).trim();

  const systemPrompt = `You are SerpHawk HRMS Executive Team Pulse Auditor.
Your job is to analyze verified daily task sheet submissions comparing TODAY against the PREVIOUS 3 WORKING DAYS across the entire team.

RULES:
1. Grounding: Rely strictly on the numbers and employee records provided. DO NOT fabricate employee names, hours, or percentages.
2. Health Status determination:
   - "high_momentum": High submission rate, hours up or stable, completion rate > 75%, minimal blockers.
   - "steady": Normal pacing, completion rate 50-75%, manageable blockers.
   - "at_risk": Submissions < 60%, multiple severe blockers, or hours dropped significantly (> 30%).
   - "critical": Submissions < 40%, widespread recurring blockers, or project stall.
3. Distinguish employees:
   - "Pending Submission": Employee has NOT submitted today.
   - "Under-reported / Incomplete": Employee submitted 0 hours with no tasks.
   - "Blocked / Needs Support": Employee flagged a blocker.
   - "High Velocity": High completion and above-average hours.
   - "Steady": Consistent output.
4. Output MUST be a strictly valid JSON object matching:
{
  "health_status": "high_momentum" | "steady" | "at_risk" | "critical",
  "headline": "A sharp, executive 1-sentence assessment summarizing team output and health",
  "executive_summary": "2 concise paragraphs synthesizing the team trajectory, workload redistribution, and velocity compared to the previous 3 working days.",
  "member_insights": [
    {
      "name": "Employee Name",
      "status": "High Velocity" | "Steady" | "Blocked / Needs Support" | "Under-reported / Incomplete" | "Pending Submission",
      "observation": "1-sentence specific observation grounded in their recorded data."
    }
  ],
  "blocker_analysis": {
    "critical": ["summary of severe blockers"],
    "recurring": ["summary of recurring blockers across days"],
    "affected_employees": ["employee names"]
  },
  "project_shifts": [
    {
      "project": "Project Name",
      "shift_type": "increased_focus" | "decreased_focus" | "neglected" | "steady",
      "observation": "1-sentence summary of effort shift"
    }
  ],
  "recommendations": [
    "Actionable management recommendation 1",
    "Actionable management recommendation 2",
    "Actionable management recommendation 3"
  ]
}`;

  const userPrompt = buildTaskSheetAiPrompt(metrics);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 35000);

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
      let msg = errText;
      try {
        msg = JSON.parse(errText).error?.message || errText;
      } catch {}
      throw new Error(`OpenAI API error (${res.status}): ${msg}`);
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error('OpenAI returned empty response.');

    const parsed = JSON.parse(content);
    return validateAndCleanResponse(parsed, model, metrics);
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error('OpenAI API request timed out after 35 seconds.');
    }
    throw err;
  }
}

/**
 * Call Gemini API as Fallback
 */
async function callGeminiPulse(metrics) {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured in .env');

  const userModel = (process.env.GEMINI_MODEL || '').trim();
  const candidateModels = Array.from(new Set([userModel, ...DEFAULT_GEMINI_MODELS].filter(Boolean)));

  const prompt = `You are SerpHawk HRMS Executive Team Pulse Auditor.
Analyze verified daily task sheet submissions comparing TODAY against the PREVIOUS 3 WORKING DAYS across the team.

${buildTaskSheetAiPrompt(metrics)}

RULES:
1. Grounding: Rely strictly on the numbers and employee records provided. DO NOT fabricate employee names, hours, or percentages.
2. Return strictly valid JSON with this shape:
{
  "health_status": "high_momentum" | "steady" | "at_risk" | "critical",
  "headline": "A sharp, executive 1-sentence assessment summarizing team output and health",
  "executive_summary": "2 concise paragraphs synthesizing the team trajectory, workload redistribution, and velocity compared to the previous 3 working days.",
  "member_insights": [
    {
      "name": "Employee Name",
      "status": "High Velocity" | "Steady" | "Blocked / Needs Support" | "Under-reported / Incomplete" | "Pending Submission",
      "observation": "1-sentence specific observation grounded in their recorded data."
    }
  ],
  "blocker_analysis": {
    "critical": ["summary of severe blockers"],
    "recurring": ["summary of recurring blockers across days"],
    "affected_employees": ["employee names"]
  },
  "project_shifts": [
    {
      "project": "Project Name",
      "shift_type": "increased_focus" | "decreased_focus" | "neglected" | "steady",
      "observation": "1-sentence summary of effort shift"
    }
  ],
  "recommendations": [
    "Actionable management recommendation 1",
    "Actionable management recommendation 2",
    "Actionable management recommendation 3"
  ]
}`;

  let lastError = null;

  for (const model of candidateModels) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 35000);

    try {
      const res = await fetch(`${endpoint}?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.2,
            maxOutputTokens: 4096,
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        const errText = await res.text();
        lastError = new Error(`Gemini (${model}) HTTP ${res.status}: ${errText}`);
        continue;
      }

      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        lastError = new Error(`Gemini (${model}) returned empty text.`);
        continue;
      }

      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        const cleaned = text.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
        parsed = JSON.parse(cleaned);
      }

      return validateAndCleanResponse(parsed, model, metrics);
    } catch (err) {
      clearTimeout(timeoutId);
      lastError = err;
    }
  }

  throw lastError || new Error('All Gemini candidate models failed to generate response.');
}

/**
 * Fetch cached AI pulse summary for a given anchor date
 */
export async function getCachedTaskSheetAiSummary({ anchorDate = null, lookbackDays = 3 } = {}) {
  const targetDate = extractIstDate(anchorDate) || indiaToday();

  const row = await db
    .prepare(
      `SELECT s.*, u.name AS generated_by_name
       FROM task_sheet_ai_summaries s
       LEFT JOIN users u ON u.id = s.generated_by
       WHERE s.target_date = ? AND s.lookback_days = ?
       LIMIT 1`
    )
    .get(targetDate, Number(lookbackDays));

  if (!row) return { exists: false, summary: null };
  return { exists: true, summary: formatTaskSheetAiSummaryRow(row) };
}

/**
 * Generates and caches fresh AI team pulse summary for target date
 */
export async function generateAndCacheTaskSheetAiPulse({
  anchorDate = null,
  lookbackDays = 3,
  user = null,
} = {}) {
  const targetDate = extractIstDate(anchorDate) || indiaToday();
  const metrics = await aggregateTaskSheetPulseMetrics({
    anchorDate: targetDate,
    lookbackDays,
  });

  // Call AI: OpenAI prioritized, Gemini fallback
  let aiResult = null;
  let aiError = null;

  if (process.env.OPENAI_API_KEY) {
    try {
      aiResult = await callOpenAiPulse(metrics);
    } catch (err) {
      console.warn('OpenAI Team Pulse generation failed, trying Gemini fallback:', err.message);
      aiError = err;
    }
  }

  if (!aiResult && process.env.GEMINI_API_KEY) {
    try {
      aiResult = await callGeminiPulse(metrics);
      aiError = null;
    } catch (err) {
      console.error('Gemini fallback generation also failed:', err.message);
      aiError = err;
    }
  }

  if (!aiResult) {
    const errorMsg = aiError
      ? `AI Generation failed: ${aiError.message}`
      : 'Neither OPENAI_API_KEY nor GEMINI_API_KEY is configured in the environment (.env).';
    throw new Error(errorMsg);
  }

  const nowIso = new Date().toISOString();
  const comparisonDatesStr = JSON.stringify(metrics.comparisonDays || []);
  const metricsStr = JSON.stringify(metrics.teamSummary || {});
  const memberInsightsStr = JSON.stringify(aiResult.memberInsights || []);
  const blockerAnalysisStr = JSON.stringify(aiResult.blockerAnalysis || {});
  const projectShiftsStr = JSON.stringify(aiResult.projectShifts || []);
  const recommendationsStr = JSON.stringify(aiResult.recommendations || []);

  const existing = await db
    .prepare(
      'SELECT id FROM task_sheet_ai_summaries WHERE target_date = ? AND lookback_days = ?'
    )
    .get(targetDate, Number(lookbackDays));

  if (existing?.id) {
    await db
      .prepare(
        `UPDATE task_sheet_ai_summaries
         SET comparison_dates_json = ?,
             headline = ?,
             executive_summary = ?,
             health_status = ?,
             metrics_comparison_json = ?,
             member_insights_json = ?,
             blocker_analysis_json = ?,
             project_shifts_json = ?,
             recommendations_json = ?,
             model_name = ?,
             generated_by = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(
        comparisonDatesStr,
        aiResult.headline,
        aiResult.executiveSummary,
        aiResult.healthStatus,
        metricsStr,
        memberInsightsStr,
        blockerAnalysisStr,
        projectShiftsStr,
        recommendationsStr,
        aiResult.modelName,
        user?.id || null,
        nowIso,
        existing.id
      );
  } else {
    await db
      .prepare(
        `INSERT INTO task_sheet_ai_summaries (
           target_date, lookback_days, comparison_dates_json, headline,
           executive_summary, health_status, metrics_comparison_json,
           member_insights_json, blocker_analysis_json, project_shifts_json,
           recommendations_json, model_name, generated_by, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        targetDate,
        Number(lookbackDays),
        comparisonDatesStr,
        aiResult.headline,
        aiResult.executiveSummary,
        aiResult.healthStatus,
        metricsStr,
        memberInsightsStr,
        blockerAnalysisStr,
        projectShiftsStr,
        recommendationsStr,
        aiResult.modelName,
        user?.id || null,
        nowIso,
        nowIso
      );
  }

  const fresh = await getCachedTaskSheetAiSummary({
    anchorDate: targetDate,
    lookbackDays,
  });

  return {
    ...fresh.summary,
    rawMetrics: metrics,
  };
}
