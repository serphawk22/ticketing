/**
 * End of Day AI Summaries Generator
 *
 * Reads AI_API_KEY from environment variables (process.env.AI_API_KEY).
 * Powered by official Google Gemini API (Gemini 3.5 Flash primary with fallbacks).
 * If missing or unavailable, gracefully provides deterministic, factual summaries grounded directly
 * in verified database metrics and task sheet submissions, with a clear configuration message.
 */

const GEMINI_DEFAULT_MODELS = ['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-flash-lite-latest'];

/**
 * Deterministic factual fallback generator when AI_API_KEY is not configured.
 * Strictly summarizes verified numbers and text without hallucinating.
 */
function buildFactualEmployeeSummary(emp, reportDate) {
  const completedCount = emp.completedWork.filter(
    (w) => w && !w.startsWith('Task Sheet Not') && !w.startsWith('None')
  ).length;
  const inProgressCount = emp.inProgressWork.filter(
    (w) => w && !w.startsWith('Task Sheet Not') && !w.startsWith('None')
  ).length;
  const blockersCount = emp.blockers.filter(
    (b) => b && !b.startsWith('Task Sheet Not') && !b.startsWith('No blockers')
  ).length;

  let progressAssessment = '';
  if (!emp.taskSheetSubmitted) {
    progressAssessment = 'Task Sheet Not Submitted for this reporting date. Ground-truth ticket board activity monitored.';
  } else if (completedCount > 0 && blockersCount === 0) {
    progressAssessment = `Good progress: ${completedCount} work item(s) completed with no blockers reported.`;
  } else if (blockersCount > 0) {
    progressAssessment = `Active blockers identified: ${blockersCount} issue(s) reported requiring attention.`;
  } else if (inProgressCount > 0) {
    progressAssessment = `Work ongoing: ${inProgressCount} item(s) actively in progress.`;
  } else {
    progressAssessment = `${emp.hoursWorked}h logged with routine daily maintenance and work tracking.`;
  }

  const nextSteps = [];
  if (emp.overdueTicketsCount > 0) {
    const keys = (emp.overdueTickets || []).map((t) => t.key).filter(Boolean);
    nextSteps.push(
      `Resolve or reschedule ${emp.overdueTicketsCount} overdue ticket(s)${keys.length ? `: ${keys.join(', ')}` : ''}`
    );
  }
  if (emp.inProgressTicketsCount > 0) {
    const keys = (emp.inProgressTickets || []).map((t) => t.key).filter(Boolean);
    nextSteps.push(
      `Continue implementation of ${emp.inProgressTicketsCount} active ticket(s)${keys.length ? `: ${keys.join(', ')}` : ''}`
    );
  }
  if (blockersCount > 0) {
    nextSteps.push(`Unblock reported challenges: ${emp.blockers.join('; ')}`);
  }
  if (!nextSteps.length) {
    nextSteps.push('Proceed with scheduled milestone tasks and board priorities.');
  }

  const textLines = [
    `Employee: ${emp.name} (${emp.role})`,
    `Status: ${emp.taskSheetSubmitted ? `Task Sheet Submitted (${emp.hoursWorked}h logged)` : 'Task Sheet Not Submitted'}`,
    `Projects: ${emp.projectsWorkedOn.join(', ')}`,
    `Completed Work: ${emp.completedWork.join('; ')}`,
    `In-Progress Work: ${emp.inProgressWork.join('; ')}`,
    `Pending Work: ${emp.pendingWork.join('; ')}`,
    `Blockers: ${emp.blockers.join('; ')}`,
    `Assigned Board Tickets: ${emp.assignedTicketsCount} total | ${emp.completedTodayCount} completed today | ${emp.overdueTicketsCount} overdue | ${emp.highPriorityTicketsCount} high priority`,
    `Progress: ${progressAssessment}`,
  ];

  return {
    employeeId: emp.id,
    employeeName: emp.name,
    employeeEmail: emp.email,
    taskSheetSubmitted: emp.taskSheetSubmitted,
    projectsWorkedOn: emp.projectsWorkedOn,
    completedWork: emp.completedWork,
    inProgressWork: emp.inProgressWork,
    pendingWork: emp.pendingWork,
    blockers: emp.blockers,
    highPriorityTickets: emp.highPriorityTickets,
    overdueTickets: emp.overdueTickets,
    nextSteps,
    overallProgress: progressAssessment,
    summaryText: textLines.join('\n'),
  };
}

/**
 * Factual team, project, and management summaries
 */
function buildFactualManagementSummary(data) {
  const { metrics, employees, projects, highPriorityTickets, overdueTickets, completedTodayTickets } = data;

  const teamSummaryHeadline = `Team Velocity Review — ${metrics.reportDate}`;
  const teamSummaryBullets = [
    `${metrics.submittedCount} of ${metrics.totalEmployees} employees submitted daily Task Sheets (${metrics.missingCount} missing), logging a combined ${metrics.totalHoursLogged} hours.`,
    `${metrics.totalCompletedToday} ticket(s) completed today across active sprint boards.`,
    `${metrics.totalHighPriority} high or urgent priority work items are currently active and monitored.`,
    metrics.totalOverdue > 0
      ? `${metrics.totalOverdue} ticket(s) are confirmed past their scheduled due date.`
      : 'All active project deliverables remain on track with zero overdue items.',
    `Active work tracked across ${projects.length} project(s) (${projects.map((p) => p.key).filter(Boolean).join(', ')}).`,
  ].slice(0, 5);

  const teamSummaryText = teamSummaryBullets.map((b) => `• ${b}`).join('\n');

  const projectSummaries = projects.map((p) => {
    const blockers = Array.isArray(p.reportedBlockers) ? p.reportedBlockers : [];
    let statusText = 'On track';
    if (p.overdueCount > 0 || blockers.length > 0) statusText = 'At risk';
    if (p.highPriorityCount > 2 && p.completedTodayCount === 0) statusText = 'Needs attention';

    return {
      projectId: p.id,
      projectKey: p.key,
      projectName: p.name,
      workspaceName: p.workspaceName,
      status: statusText,
      totalActive: p.totalActiveTickets,
      completedToday: p.completedTodayCount,
      inProgress: p.inProgressCount,
      open: p.openCount,
      overdue: p.overdueCount,
      highPriority: p.highPriorityCount,
      blockers: blockers,
      summary: `Active: ${p.totalActiveTickets} tickets | ${p.completedTodayCount} completed today | ${p.inProgressCount} in progress | ${p.overdueCount} overdue.${blockers.length ? ` Blockers: ${blockers.join('; ')}` : ''}`,
    };
  });

  const highPrioritySummary = highPriorityTickets.length
    ? `${highPriorityTickets.length} high-priority work items active across ${new Set(highPriorityTickets.map((t) => t.projectName)).size} project(s). Key items: ${highPriorityTickets.map((t) => `${t.key} (${t.assignee}): ${t.title}`).slice(0, 5).join('; ')}.`
    : 'No critical or urgent blockers currently flagged on the board.';

  const overdueSummary = overdueTickets.length
    ? `${overdueTickets.length} ticket(s) are confirmed past their due dates. Key overdue items: ${overdueTickets.map((t) => `${t.key} (due ${t.dueDate}, assigned to ${t.assignee}): ${t.title}`).slice(0, 5).join('; ')}.`
    : 'No overdue tickets recorded for this reporting period.';

  const blockerRiskBullets = [];
  for (const emp of employees) {
    if (emp.taskSheetSubmitted && emp.blockers?.length && !emp.blockers[0].startsWith('No blockers')) {
      for (const b of emp.blockers) {
        if (b && !b.startsWith('Task Sheet Not') && !b.startsWith('No blockers') && !b.startsWith('None')) {
          blockerRiskBullets.push(`[Confirmed Blocker] ${emp.projectsWorkedOn?.join(', ') || 'General'} (${emp.name}): ${b}`);
        }
      }
    }
  }
  if (overdueTickets.length > 0) {
    for (const t of overdueTickets.slice(0, 3)) {
      blockerRiskBullets.push(`[Potential Risk] Ticket #${t.key} in ${t.projectName}: Past due date (${t.dueDate}), assigned to ${t.employeeName || 'Unassigned'}.`);
    }
  }
  if (!blockerRiskBullets.length) {
    blockerRiskBullets.push('No active operational blockers or delivery risks reported.');
  }

  const blockerRiskAnalysis = blockerRiskBullets.map((b) => `• ${b}`).join('\n');

  const recommendations = [];
  if (metrics.missingCount > 0) {
    const missingNames = employees.filter((e) => !e.taskSheetSubmitted).map((e) => e.name);
    recommendations.push(
      `Follow up on ${metrics.missingCount} missing Task Sheet submission(s): ${missingNames.slice(0, 4).join(', ')}.`
    );
  }
  if (overdueTickets.length > 0) {
    recommendations.push(
      `Review deadlines and resource allocation for ${overdueTickets.length} overdue ticket(s).`
    );
  }
  if (highPriorityTickets.length > 0) {
    recommendations.push(
      `Prioritize ${highPriorityTickets.length} high/urgent priority tickets for tomorrow's sprint cycle.`
    );
  }
  if (blockerRiskBullets.some((b) => b.startsWith('[Confirmed Blocker]'))) {
    recommendations.push('Coordinate with relevant project leads to resolve active blockers.');
  }
  if (!recommendations.length) {
    recommendations.push('Maintain current delivery pace and verify milestone deliverables.');
  }

  return {
    teamSummary: {
      headline: teamSummaryHeadline,
      summaryBullets: teamSummaryBullets,
      summaryText: teamSummaryText,
      totalHoursLogged: metrics.totalHoursLogged,
      submittedCount: metrics.submittedCount,
      missingCount: metrics.missingCount,
    },
    projectSummaries,
    managementSummary: {
      highPrioritySummary,
      overdueSummary,
      blockerRiskBullets,
      blockerRiskAnalysis,
      recommendations,
      nextSteps: recommendations,
    },
  };
}

/**
 * Calls Google Gemini REST endpoint securely with AI_API_KEY
 */
async function callGeminiAi(apiKey, prompt) {
  let lastError = null;

  for (const model of GEMINI_DEFAULT_MODELS) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 35000);

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.2,
            maxOutputTokens: 8192,
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
      return { parsed: JSON.parse(cleanJson), model };
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
      if (model === GEMINI_DEFAULT_MODELS[GEMINI_DEFAULT_MODELS.length - 1]) throw err;
    }
  }

  throw lastError || new Error('All Gemini candidate models failed to respond.');
}

/**
 * Main AI Summary Generator for End of Day Reports
 *
 * @param {object} collectedData - Output from collectEndOfDayData
 * @returns {Promise<{
 *   aiConfigured: boolean,
 *   aiModel: string,
 *   configNotice: string,
 *   employeeSummaries: Array,
 *   teamSummary: object,
 *   projectSummaries: Array,
 *   managementSummary: object,
 * }>}
 */
export async function generateEndOfDayAiSummaries(collectedData) {
  const apiKey = (process.env.AI_API_KEY || '').trim();

  // If AI_API_KEY is not configured, generate verified factual deterministic summaries
  if (!apiKey) {
    const fallbackManagement = buildFactualManagementSummary(collectedData);
    const employeeSummaries = collectedData.employees.map((emp) =>
      buildFactualEmployeeSummary(emp, collectedData.reportDate)
    );

    return {
      aiConfigured: false,
      aiModel: 'factual-fallback',
      configNotice:
        'AI_API_KEY is not configured in the server environment (.env). Displaying factual summaries based strictly on verified database records.',
      employeeSummaries,
      teamSummary: fallbackManagement.teamSummary,
      projectSummaries: fallbackManagement.projectSummaries,
      managementSummary: fallbackManagement.managementSummary,
    };
  }

  // AI_API_KEY is configured: synthesize rich grounded summaries
  const prompt = `
You are an executive engineering auditor generating the End of Day Report for ${collectedData.reportDate}.
Analyze the verified database metrics and employee Task Sheet submissions below.
DO NOT invent ticket numbers, completion events, percentages, or blockers not present in the data.

VERIFIED METRICS:
${JSON.stringify(collectedData.metrics, null, 2)}

EMPLOYEE DATA (Ground Truth):
${JSON.stringify(
  collectedData.employees.map((e) => ({
    name: e.name,
    role: e.role,
    taskSheetSubmitted: e.taskSheetSubmitted,
    hoursWorked: e.hoursWorked,
    projects: e.projectsWorkedOn,
    completedWork: e.completedWork,
    inProgressWork: e.inProgressWork,
    pendingWork: e.pendingWork,
    blockers: e.blockers,
    assignedTicketsCount: e.assignedTicketsCount,
    completedTodayCount: e.completedTodayCount,
    overdueTicketsCount: e.overdueTicketsCount,
    highPriorityTicketsCount: e.highPriorityTicketsCount,
  })),
  null,
  2
)}

PROJECT DATA:
${JSON.stringify(
  collectedData.projects.map((p) => ({
    key: p.key,
    name: p.name,
    totalActive: p.totalActiveTickets,
    completedToday: p.completedTodayCount,
    inProgress: p.inProgressCount,
    overdue: p.overdueCount,
    highPriority: p.highPriorityCount,
    blockers: p.reportedBlockers,
  })),
  null,
  2
)}

FORMATTING AND SYNTHESIS RULES:
1. Team Summary: MUST be strictly 4 to 5 concise bullet points in "team_summary_bullets" covering team progress, completed work, logged hours, Task Sheet submissions, and key project updates. Keep each point short (under 20 words) and easy to understand. Do NOT generate long paragraphs.
2. Management Recommendations: MUST be strictly short, actionable bullet points in "recommendations" clearly stating the most important actions that Admin or management should take. Avoid lengthy explanations.
3. Blocker & Risk Analysis: MUST be strictly concise bullet points in "blocker_risk_bullets". Distinguish between confirmed blockers (prefixed with "[Confirmed Blocker]") and potential risks (prefixed with "[Potential Risk]"). Mention the affected ticket, project, and blocker where available. If no blockers or risks exist in the data, return strictly: ["No active operational blockers or delivery risks reported."]. Do NOT generate paragraphs or invent blockers that do not exist.
4. Keep all numbers, names, and ticket keys strictly grounded in the verified data.

Return a single JSON object matching this structure (JSON only, no markdown, no codeblock):
{
  "team_headline": "1 concise sentence summarizing today's delivery and throughput",
  "team_summary_bullets": [
    "Bullet 1: Task sheet submissions and hours logged",
    "Bullet 2: Verified completions across sprint boards",
    "Bullet 3: Active high priority tickets and focus areas",
    "Bullet 4: Overdue tickets and deadline tracking",
    "Bullet 5: Key project delivery status"
  ],
  "high_priority_summary": "Summary of active critical/urgent work items",
  "overdue_summary": "Distinguish confirmed overdue items from potential delays",
  "blocker_risk_bullets": [
    "[Confirmed Blocker] Project (Employee): Specific blocker description",
    "[Potential Risk] Ticket #KEY in Project: Potential risk or overdue notice"
  ],
  "recommendations": [
    "Short actionable recommendation 1",
    "Short actionable recommendation 2",
    "Short actionable recommendation 3"
  ],
  "employee_summaries": [
    {
      "employee_name": "Exact Name",
      "overall_progress": "1-2 sentence concise progress assessment",
      "next_steps": ["Specific next step 1", "Specific next step 2"]
    }
  ]
}
`.trim();

  try {
    const { parsed, model } = await callGeminiAi(apiKey, prompt);
    const fallbackManagement = buildFactualManagementSummary(collectedData);

    // Merge LLM insights with verified ground-truth fields
    const employeeMap = new Map((parsed.employee_summaries || []).map((s) => [s.employee_name?.toLowerCase(), s]));

    const employeeSummaries = collectedData.employees.map((emp) => {
      const factual = buildFactualEmployeeSummary(emp, collectedData.reportDate);
      const llmInsight = employeeMap.get(emp.name.toLowerCase());

      return {
        ...factual,
        overallProgress: llmInsight?.overall_progress || factual.overallProgress,
        nextSteps: Array.isArray(llmInsight?.next_steps) && llmInsight.next_steps.length
          ? llmInsight.next_steps
          : factual.nextSteps,
      };
    });

    // Extract team summary bullets (strictly 4-5 concise bullets)
    let teamSummaryBullets = [];
    if (Array.isArray(parsed.team_summary_bullets) && parsed.team_summary_bullets.length > 0) {
      teamSummaryBullets = parsed.team_summary_bullets
        .map((b) => String(b).replace(/^[•\-\*\d\.]+\s*/, '').trim())
        .filter(Boolean)
        .slice(0, 5);
    } else if (typeof parsed.team_summary_text === 'string') {
      teamSummaryBullets = parsed.team_summary_text
        .split(/\r?\n|•/)
        .map((b) => b.replace(/^[•\-\*\d\.]+\s*/, '').trim())
        .filter((b) => b.length > 3)
        .slice(0, 5);
    }
    if (!teamSummaryBullets.length) {
      teamSummaryBullets = fallbackManagement.teamSummary.summaryBullets;
    }
    const teamSummaryText = teamSummaryBullets.map((b) => `• ${b}`).join('\n');

    // Extract blocker & risk bullets
    let blockerRiskBullets = [];
    if (Array.isArray(parsed.blocker_risk_bullets) && parsed.blocker_risk_bullets.length > 0) {
      blockerRiskBullets = parsed.blocker_risk_bullets
        .map((b) => String(b).replace(/^[•\-\*]+\s*/, '').trim())
        .filter(Boolean);
    } else if (typeof parsed.blocker_risk_analysis === 'string') {
      blockerRiskBullets = parsed.blocker_risk_analysis
        .split(/\r?\n|•/)
        .map((b) => b.replace(/^[•\-\*]+\s*/, '').trim())
        .filter((b) => b.length > 3);
    }
    if (!blockerRiskBullets.length) {
      blockerRiskBullets = fallbackManagement.managementSummary.blockerRiskBullets;
    }
    const blockerRiskAnalysis = blockerRiskBullets.map((b) => `• ${b}`).join('\n');

    // Extract recommendations
    let recommendations = [];
    if (Array.isArray(parsed.recommendations) && parsed.recommendations.length > 0) {
      recommendations = parsed.recommendations
        .map((r) => String(r).replace(/^[•\-\*\d\.]+\s*/, '').trim())
        .filter(Boolean);
    }
    if (!recommendations.length) {
      recommendations = fallbackManagement.managementSummary.recommendations;
    }

    return {
      aiConfigured: true,
      aiModel: model,
      configNotice: `Generated with AI (${model}) grounded in verified database metrics.`,
      employeeSummaries,
      teamSummary: {
        headline: parsed.team_headline || fallbackManagement.teamSummary.headline,
        summaryBullets: teamSummaryBullets,
        summaryText: teamSummaryText,
        totalHoursLogged: collectedData.metrics.totalHoursLogged,
        submittedCount: collectedData.metrics.submittedCount,
        missingCount: collectedData.metrics.missingCount,
      },
      projectSummaries: fallbackManagement.projectSummaries,
      managementSummary: {
        highPrioritySummary: parsed.high_priority_summary || fallbackManagement.managementSummary.highPrioritySummary,
        overdueSummary: parsed.overdue_summary || fallbackManagement.managementSummary.overdueSummary,
        blockerRiskBullets,
        blockerRiskAnalysis,
        recommendations,
        nextSteps: recommendations,
      },
    };
  } catch (err) {
    console.error('[end-of-day:ai] LLM call failed, falling back to factual summary:', err.message);
    const fallbackManagement = buildFactualManagementSummary(collectedData);
    const employeeSummaries = collectedData.employees.map((emp) =>
      buildFactualEmployeeSummary(emp, collectedData.reportDate)
    );

    return {
      aiConfigured: false,
      aiModel: 'factual-fallback',
      configNotice: `AI generation encountered an error (${err.message}). Displaying verified factual summaries.`,
      employeeSummaries,
      teamSummary: fallbackManagement.teamSummary,
      projectSummaries: fallbackManagement.projectSummaries,
      managementSummary: fallbackManagement.managementSummary,
    };
  }
}
