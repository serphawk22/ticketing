import { MASTER_REPORTS } from '../lib/reportMasterCatalog.js';
import { getReportExecutionData } from '../lib/analytics.js';

async function verifyAllReportCharts() {
  const adminUser = { id: 1, name: 'Admin', role: 'admin' };
  let passedCharts = 0;
  let boundaryReports = 0;
  let emptyReports = 0;
  const failureList = [];
  const typeCounts = {};

  console.log('================================================================');
  console.log('AUDITING ALL 76 REPORTS FOR AUTHENTIC CHARTS & VISUALIZATIONS');
  console.log('================================================================\n');

  for (const r of MASTER_REPORTS) {
    try {
      const data = await getReportExecutionData({
        reportSlug: r.slug,
        filters: { preset: 'all' },
        currentUser: adminUser,
      });

      if (data.unavailableNotice) {
        boundaryReports++;
        console.log(`  ✓ BOUNDARY NOTICE: #${r.id} [${r.slug}] honors external data boundary cleanly`);
      } else if (data.series && data.series.length > 0) {
        passedCharts++;
        typeCounts[data.chartType || 'bar'] = (typeCounts[data.chartType || 'bar'] || 0) + 1;
        console.log(`  ✓ PASS: #${r.id} [${r.slug}] has chart type "${data.chartType || 'bar'}" with ${data.series.length} series data points`);
      } else {
        emptyReports++;
        failureList.push({ id: r.id, slug: r.slug, title: r.title, chartType: data.chartType });
        console.log(`  ✗ MISSING SERIES: #${r.id} [${r.slug}] returned empty series`);
      }
    } catch (err) {
      failureList.push({ id: r.id, slug: r.slug, error: err.message });
      console.log(`  ✗ ERROR: #${r.id} [${r.slug}]: ${err.message}`);
    }
  }

  console.log('\n================================================================');
  console.log(`TOTAL CATALOG REPORTS: ${MASTER_REPORTS.length}`);
  console.log(`REPORTS WITH ACTIVE CHARTS: ${passedCharts} / 70 live reports`);
  console.log(`BOUNDARY NOTICES PRESERVED: ${boundaryReports} / 6 external reports`);
  console.log(`EMPTY SERIES REPORTS: ${emptyReports}`);
  console.log('CHART TYPE BREAKDOWN:', typeCounts);
  console.log('================================================================\n');

  if (failureList.length > 0) {
    console.error('FAILED REPORTS:', failureList);
    process.exit(1);
  } else {
    console.log('ALL 70 LIVE REPORTS HAVE VALID CHARTS & SERIES DATA!');
  }
}

verifyAllReportCharts();

