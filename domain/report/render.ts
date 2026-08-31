import type { ReportData, ReportFindingView } from "@/domain/report/types";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function esc(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  return escapeHtml(String(value));
}

function renderFinding(finding: ReportFindingView, reportType: "internal" | "client"): string {
  const riskLine =
    reportType === "client"
      ? finding.riskLevelLabel
        ? `<p class="risk">רמת סיכון: <strong>${esc(finding.riskLevelLabel)}</strong></p>`
        : ""
      : `<p class="risk">רמת סיכון: <strong>${esc(finding.riskLevel)}</strong> (${esc(finding.riskScore)}/100)</p>`;

  const confidenceLine =
    reportType === "client"
      ? finding.confidenceCaveat
        ? `<p class="confidence-caveat">${esc(finding.confidenceCaveat)}</p>`
        : ""
      : `<p class="confidence">רמת ודאות: ${esc(finding.confidence)}/4</p>`;

  const internalOnly =
    reportType === "internal"
      ? `
      ${finding.ruleId ? `<p class="rule-id">Rule ID: ${esc(finding.ruleId)}</p>` : ""}
      ${finding.legalSourceUrl ? `<p class="legal-source">מקור משפטי: <a href="${esc(finding.legalSourceUrl)}">${esc(finding.legalSourceUrl)}</a></p>` : ""}
      ${finding.possibleService ? `<p class="possible-service">שירות אפשרי: ${esc(finding.possibleService)}</p>` : ""}
      ${finding.cautionNote ? `<p class="caution-note">הערת זהירות: ${esc(finding.cautionNote)}</p>` : ""}
      ${
        finding.inputSnapshot
          ? `<details class="input-snapshot"><summary>נתונים תומכים</summary><pre>${esc(JSON.stringify(finding.inputSnapshot, null, 2))}</pre></details>`
          : ""
      }`
      : "";

  return `
    <section class="finding">
      <h3>${esc(finding.title)}</h3>
      <p class="category">${esc(finding.category)}</p>
      ${riskLine}
      ${confidenceLine}
      ${finding.recommendedAction ? `<p class="recommendation">פעולה מומלצת: ${esc(finding.recommendedAction)}</p>` : ""}
      ${internalOnly}
    </section>`;
}

function renderFreelancerSection(data: ReportData): string {
  if (!data.freelancerScreening) return "";
  const { totalPoints, indicators, disclosure } = data.freelancerScreening;
  const rows = indicators
    .filter((i) => i.contributed)
    .map(
      (i) =>
        `<li>${esc(i.indication)} (${esc(i.condition)}): ${i.points > 0 ? "+" : ""}${esc(i.points)}</li>`,
    )
    .join("");
  return `
    <section class="freelancer-screening">
      <h2>סקירת פרילנסרים</h2>
      <p class="disclosure">${esc(disclosure)}</p>
      <p>ניקוד כולל: ${esc(totalPoints)}</p>
      <ul>${rows}</ul>
    </section>`;
}

/** Renders one report's structured content (domain/report/build.ts) into a standalone RTL HTML document. Pure function — no I/O. */
export function renderReportHtml(data: ReportData): string {
  const title = data.reportType === "client" ? "דוח ללקוח" : "דוח פנימי";
  const findingsHtml = data.findings.map((f) => renderFinding(f, data.reportType)).join("\n");
  const summaryRows = Object.entries(data.summary.countByRiskLevel)
    .map(([level, count]) => `<li>${esc(level)}: ${esc(count)}</li>`)
    .join("");

  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8" />
<title>${esc(title)}</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 2rem; color: #1a1a1a; }
  h1 { font-size: 1.5rem; }
  h2 { font-size: 1.2rem; margin-top: 2rem; }
  h3 { font-size: 1.05rem; margin-bottom: 0.25rem; }
  .finding { border: 1px solid #ddd; border-radius: 8px; padding: 1rem; margin: 1rem 0; }
  .category { color: #555; font-size: 0.9rem; }
  .disclosure { font-style: italic; color: #555; }
  pre { white-space: pre-wrap; font-size: 0.8rem; background: #f5f5f5; padding: 0.5rem; }
  .synthetic-banner { border: 3px solid #b45309; background: #fffbeb; color: #92400e; font-weight: bold; padding: 1rem; margin-bottom: 1.5rem; border-radius: 8px; }
</style>
</head>
<body>
  <h1>${esc(title)}</h1>
  ${
    data.usedSyntheticData
      ? `<div class="synthetic-banner">⚠ דוח פיילוט — מבוסס על נתוני בדיקה סינתטיים (Synthetic Pilot Data). אינו מבוסס על חילוץ אמיתי ממסמכים ואסור לשלוח אותו ללקוח.</div>`
      : ""
  }
  <p>מזהה הערכה: ${esc(data.assessmentId)}</p>
  <p>נוצר בתאריך: ${esc(data.generatedAt)}</p>

  <section class="summary">
    <h2>סיכום</h2>
    <p>סך הכל ממצאים: ${esc(data.summary.totalFindings)}</p>
    <ul>${summaryRows}</ul>
  </section>

  <section class="findings">
    <h2>ממצאים</h2>
    ${findingsHtml || "<p>אין ממצאים להצגה.</p>"}
  </section>

  ${renderFreelancerSection(data)}
</body>
</html>`;
}
