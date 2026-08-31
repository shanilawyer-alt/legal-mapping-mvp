# Pilot Runbook — First Attorney-Operated Browser Pilot

For the attorney, driving the deployed app in a real browser against a **real Supabase project** that has already passed the checklist in `PILOT_VALIDATION_PLAN.md` §3. This runs the synthetic fixture described in that plan's §5 — no real client is involved anywhere in this runbook.

**Before you start**, confirm from `PILOT_VALIDATION_PLAN.md`:
- §3 checklist items 1–3 are done (migrations applied, RLS confirmed, your attorney account exists as the *only* Supabase Auth user with public sign-up disabled).
- You are signed in at `/admin/login` with that account.

**Operational notes to keep in mind throughout** (details in `PILOT_VALIDATION_PLAN.md` §1):
- **Single run only**: "Run Analysis" can be clicked exactly once per assessment. If you upload the wrong document or answer something wrong before that point, don't try to fix it in place — create a fresh assessment and start over.
- **Risk scores will look low.** The automatic score only uses each rule's base severity — it deliberately does not (and cannot, per `OPEN_QUESTIONS.md` item 28) factor in how many employees are affected, how long a practice has continued, or an active dispute. A `HIGH`-severity rule may show a score around 40–50, not 65+. Use the severity-override action if you judge a finding should score higher once you've read the actual context.
- **The report preview is intentionally minimal.** No narrative summary is generated (`OPEN_QUESTIONS.md` item 29) — just a factual count of findings by risk level. This is by design, not a bug.
- **The pilot fixture tag field is pilot-only.** Never select anything but the blank option once a real client's assessment is in front of you.

---

## Phase 1 — Create the assessment

1. On `/admin`, find the "יצירת מיפוי חדש" (create new assessment) panel.
2. In "שם העסק" (business name), enter e.g. `עסק פיילוט לדוגמה בע"מ`.
3. Click "צור קישור מאובטח" (create secure link).
4. **Copy the link shown** (`/assessment/<token>`) — it is shown once only. Open it in a new private/incognito browser window (simulating the client's browser, separate from your admin session).

## Phase 2 — Complete the questionnaire (as the simulated client)

Work through every section in order. For most questions, any valid answer is fine — the specific values below are the only ones that matter for this fixture; everything else just needs to be *answered* if marked required, so the assessment can be submitted.

**Answer these specific questions with these exact values** (use the search/scroll to find each by its visible Hebrew text):

| Section | Question (visible text) | Answer |
|---|---|---|
| קליטת עובדים ומסמכים | "האם קיים הסכם עבודה בכתב עם כל העובדים?" | **לא** |
| קליטת עובדים ומסמכים | "האם נמסרה לעובדים הודעה בכתב על תנאי העבודה?" | **לא** |
| שעות עבודה ונוכחות | "האם עובדים מבצעים שעות נוספות?" | **כן, באופן קבוע** |
| שעות עבודה ונוכחות | "כיצד משולמות שעות נוספות?" (appears after the above) | **רכיב שעות נוספות גלובלי** |
| שעות עבודה ונוכחות | "אם משולם רכיב שעות נוספות גלובלי — האם הוא מופיע כרכיב נפרד בתלוש?" (appears after the above) | **לא יודעת** |
| זכויות סוציאליות | "האם מבוצעות הפרשות פנסיוניות לכל העובדים הזכאים לכך?" | **כן** (this is what keeps the pension-shortfall rule *unmatched* — the fixture's "no-finding rule" demonstration) |

Answer every other currently-visible required question with any real value from its own option list (or a short placeholder for free-text fields — never a real person's actual data, since this is a synthetic fixture).

**Upload documents at these two points** (a "בחירת קובץ" file picker appears directly under the relevant question once you answer it):
- At "האם קיים הסכם עבודה בכתב עם כל העובדים?" — upload any small PDF (content doesn't matter; extraction uses the fixture tag selected in Phase 4, not real file content). A one-page PDF with any text works.
- At "האם ניתן להעלות דו״ח נוכחות של עובד אחד מחודש מייצג?" — answer "כן" if asked, then upload any small PDF the same way.

When every required question is answered, proceed to the review screen and click the final submit button ("שליחה סופית"). Confirm the screen changes to a locked "submitted" confirmation — the client side of this runbook is now done.

## Phase 3 — Run Analysis (back in your admin browser window)

1. Return to your admin session. On `/admin`, open the new assessment (it should show status "נשלח — ממתין לניתוח").
2. In the profile section, find the "הרצת ניתוח" (Run Analysis) box. **If it is not amber-highlighted with a fixture-tag dropdown inside it, `PILOT_SYNTHETIC_MODE_ENABLED` is not set to `true` in this deployment — stop and fix that first (`ATTORNEY_PILOT_START_HERE.md` §B/§C).**
3. In its "תג פיקסצ'ר לפיילוט מבוקר בלבד" dropdown, select **`B-overtime-mismatch`**. (Never do this for a real client — leave it blank.)
4. Click "הרצת ניתוח" and confirm the dialog. The page reloads with status "בבדיקת עורך/ת דין".

**Verify** (per `PILOT_VALIDATION_PLAN.md` §5):
- "עובדות שחולצו" (extracted facts) section is non-empty, each fact showing a source and confidence.
- "הצלבות" (cross-checks) section shows at least one entry — the global-overtime/attendance mismatch.
- "ממצאים" (findings) section shows multiple findings, including one titled "היעדר מסמך תנאי עבודה" (the `R-EMP-001` match) and one referencing the overtime component (`R-TIME-003`), plus at least one always-present manual-review finding (`R-INC-001`, always `CRITICAL`).
- At least one rule you'd expect *not* to fire (e.g. nothing pension-related) correctly does not appear as a finding.

## Phase 4 — Attorney review

For each finding in the "ממצאים" section:
1. Read its category, risk level/score, confidence, recommendation, and (expand "נתונים תומכים") the exact facts that triggered it.
2. Click "אישור" (confirm) or "דחייה" (dismiss) as your judgment calls for. **Every `CRITICAL` finding still marked "טיוטה" (draft) must be confirmed or dismissed before you can approve the assessment** — this is enforced, not optional.
3. For at least one finding, try the manual severity override: enter a number 1–5 and a reason, then save — confirm the finding now shows the overridden value and your reason.
4. For at least one finding, add a note via "הוספת הערה".
5. Toggle "הצגה ללקוח" (show to client) **on** for exactly one or two findings you're comfortable with a client seeing — this controls what the client report will contain.

## Phase 5 — Report preview

1. In the "דוחות" (reports) section, click "יצירת תצוגה מקדימה — דוח פנימי" (generate internal preview). Click "צפייה" on the new row — confirm it shows every finding, including risk scores, Rule IDs, and the facts that triggered each one.
2. Click "יצירת תצוגה מקדימה — דוח ללקוח" (generate client preview). Click "צפייה" — confirm it shows **only** the findings you toggled visible in Phase 4, with a risk *label* (e.g. "בינוני") rather than a raw score, and **no** Rule IDs, legal-source links, or internal notes anywhere in the page.

## Phase 6 — Approval and the release boundary (release is expected to be BLOCKED)

1. Attempt to release before approving: the "שליחת דוח ללקוח" button is genuinely absent while status is "בבדיקת עורך/ת דין". This is the boundary working correctly, not a missing feature.
2. Once every `CRITICAL` finding is resolved (Phase 4), click "אישור מיפוי" (approve) in the profile section and confirm the dialog. Status changes to "אושר". If it doesn't — the confirmation dialog or an error banner will say a `CRITICAL` finding is still unresolved; go back to Phase 4.
3. A "שליחת דוח ללקוח" (send report to client) button now appears. Click it and confirm the dialog.
4. **Expected result: this fails.** An error banner reading "לא ניתן לשלוח דוח ללקוח: הניתוח בוצע באמצעות נתוני בדיקה סינתטיים..." appears, and the status stays "אושר" — it never reaches "דוח נשלח ללקוח". This is the release-protection safeguard working as designed: any assessment analyzed with a pilot fixture tag can never be released to a client, no matter how thoroughly it was reviewed and approved. If release instead succeeds, **stop — this is a safeguard failure, not a pass.**
5. Generate one more preview (Phase 5) and confirm both the internal and client preview HTML show the amber "⚠ דוח פיילוט" banner at the top.

## Phase 7 — Audit trail check

Scroll to "יומן פעילות" (activity log) at the bottom of the page. Confirm it lists, in order: the secure link being opened, each answer saved, the document uploads, the questionnaire submission, "ניתוח הורץ" (analysis run), one or more "ממצא נבדק" (finding reviewed) entries, "תצוגה מקדימה של דוח נוצרה" (report preview generated) entries, and "המיפוי אושר" (assessment approved). There should be **no** "דוח נשלח ללקוח" (report released) entry — release was blocked in Phase 6.

---

## If something doesn't match this runbook

Stop and do not proceed to a real client. Note exactly which phase/step failed and what happened instead, and treat it the same way `PILOT_VALIDATION_PLAN.md` §2's two defects were treated: a specific, reproducible defect report, not a guess.
