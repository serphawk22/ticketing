import { csvCell, downloadCsv } from './csv.js';

/**
 * Builds an enhanced CSV file with metadata header (title, range, generation timestamp)
 * and data rows.
 */
export function buildReportCsv({
  title,
  dateRangeLabel,
  filtersApplied = {},
  columns,
  rows,
}) {
  const lines = [];

  // Metadata block
  lines.push(`"${title}"`);
  lines.push(`"Generated At: ${new Date().toISOString()}"`);
  if (dateRangeLabel) lines.push(`"Date Range: ${dateRangeLabel}"`);

  const filterEntries = Object.entries(filtersApplied).filter(
    ([, v]) => v !== undefined && v !== null && v !== 'all' && v !== ''
  );
  if (filterEntries.length > 0) {
    const filterStr = filterEntries.map(([k, v]) => `${k}=${v}`).join('; ');
    lines.push(`"Filters: ${filterStr}"`);
  }
  lines.push(''); // blank line

  // Column Headers
  lines.push(columns.map((c) => csvCell(c.label)).join(','));

  // Rows
  for (const row of rows) {
    lines.push(
      columns
        .map((c) => {
          const val = c.get ? c.get(row) : row[c.key];
          return csvCell(val);
        })
        .join(',')
    );
  }

  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

/**
 * Builds an Excel-compatible XML Spreadsheet document.
 * This format is opened natively by Microsoft Excel, LibreOffice, and Google Sheets,
 * and supports styled headers, metadata, and cell typing.
 */
export function buildExcelXml({
  title,
  dateRangeLabel,
  filtersApplied = {},
  columns,
  rows,
}) {
  const escapeXml = (str) =>
    String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');

  const filterEntries = Object.entries(filtersApplied)
    .filter(([, v]) => v !== undefined && v !== null && v !== 'all' && v !== '')
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal">
   <Alignment ss:Vertical="Bottom"/>
   <Font ss:FontName="Calibri" ss:Size="11" ss:Color="#000000"/>
  </Style>
  <Style ss:ID="Title">
   <Font ss:FontName="Calibri" ss:Size="16" ss:Bold="1" ss:Color="#0c66e4"/>
  </Style>
  <Style ss:ID="Meta">
   <Font ss:FontName="Calibri" ss:Size="10" ss:Italic="1" ss:Color="#626f86"/>
  </Style>
  <Style ss:ID="Header">
   <Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1" ss:Color="#FFFFFF"/>
   <Interior ss:Color="#0c66e4" ss:Pattern="Solid"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#09326c"/>
   </Borders>
  </Style>
  <Style ss:ID="Data">
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#ebecf0"/>
   </Borders>
  </Style>
 </Styles>
 <Worksheet ss:Name="Report">
  <Table>
   <Row>
    <Cell ss:StyleID="Title"><Data ss:Type="String">${escapeXml(title)}</Data></Cell>
   </Row>
   <Row>
    <Cell ss:StyleID="Meta"><Data ss:Type="String">Generated: ${new Date().toISOString()} | Period: ${escapeXml(dateRangeLabel || 'All')}</Data></Cell>
   </Row>
   ${
     filterEntries
       ? `<Row><Cell ss:StyleID="Meta"><Data ss:Type="String">Filters: ${escapeXml(filterEntries)}</Data></Cell></Row>`
       : ''
   }
   <Row ss:Index="${filterEntries ? 4 : 3}"/>
   <Row ss:StyleID="Header">
    ${columns.map((c) => `<Cell><Data ss:Type="String">${escapeXml(c.label)}</Data></Cell>`).join('')}
   </Row>
`;

  for (const row of rows) {
    xml += '   <Row ss:StyleID="Data">\n';
    for (const c of columns) {
      const val = c.get ? c.get(row) : row[c.key];
      const isNum = typeof val === 'number' && Number.isFinite(val);
      xml += `    <Cell><Data ss:Type="${isNum ? 'Number' : 'String'}">${escapeXml(val)}</Data></Cell>\n`;
    }
    xml += '   </Row>\n';
  }

  xml += `  </Table>
 </Worksheet>
</Workbook>`;

  return xml;
}

/**
 * Trigger download of an Excel XML file with .xls extension
 */
export function downloadExcelXml(filename, xml) {
  if (typeof document === 'undefined') return;
  const blob = new Blob([xml], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.endsWith('.xls') || filename.endsWith('.xlsx') ? filename : `${filename}.xls`;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * PDF Export handler: prints or opens print preview dialog with dedicated @media print CSS
 */
export function triggerPdfPrint() {
  if (typeof window !== 'undefined') {
    window.print();
  }
}

