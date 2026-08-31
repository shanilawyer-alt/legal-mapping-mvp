# Attorney Pilot — Start Here

This is the only document you need. It assumes no coding background. Follow the sections in order — do not skip ahead.

**Do not invite a real client yet.** This document walks you through connecting the app to your real Supabase project and running one **synthetic (fake-data) pilot** yourself, as a rehearsal. Section F explains exactly what must happen after that before a real client is ever invited.

If anyone other than you (a developer, an IT person) is handling the technical setup in sections A and B, you can hand them this document — everything is written to be followed exactly, in order, with no guessing required.

---

## A. Real Supabase Setup

Supabase is the database and storage service this app runs on. You need one Supabase **project** already created (if one doesn't exist yet, someone with access needs to create it at supabase.com first — that one step isn't covered here, since it depends on your organization's account).

### A1. Find your project

1. Go to **supabase.com/dashboard** in a browser and sign in.
2. If you belong to more than one organization, pick the correct one from the top-left switcher.
3. Click the project meant for this app (its name was chosen when it was created — ask whoever created it if you're unsure which one).

**PASS**: you land on a page with a left sidebar showing icons for Table Editor, SQL Editor, Database, Authentication, Storage, etc.
**STOP if**: you don't see this project in the list at all — you need to be added to the Supabase organization first. Ask whoever manages your organization's Supabase account.

### A2. Confirm the database structure is up to date ("apply migrations")

This app needs 4 specific pieces of database setup ("migrations"), applied in order. Someone with developer access may have already done this when the app was deployed — check first before redoing anything.

1. In the left sidebar, click **Table Editor**.
2. Look for these table names in the list: `organizations`, `assessments`, `answers`, `documents`, `document_extractions`, `derived_facts`, `rule_evaluations`, `findings`, `reports`, `audit_events`, `assessment_sessions`, `admin_profiles`.

**PASS**: all of the above table names are present.
**STOP if**: the table list is empty, or several of these names are missing. The migrations have not been applied. Ask a developer to run them (they are plain SQL files in the app's codebase, folder `supabase/migrations/`, meant to be applied in filename order — this step requires developer tooling and is not something to attempt by pasting SQL manually without technical help, since a mistake here can corrupt the database).

### A3. Verify the relevant tables exist (detail check)

1. Still in **Table Editor**, click on `rule_evaluations`.
2. **PASS**: the table opens and shows columns including `assessment_id`, `rule_id`, `risk_score`, `risk_level`.
3. Repeat for `findings` (expect columns including `status`, `visible_to_client`, `severity_override`) and `reports` (expect columns including `report_type`, `version`, `storage_path`).

**STOP if**: any of these three tables is missing or looks structurally different (missing columns) — this means the migrations are incomplete or out of date. Do not proceed; get developer help.

### A4. Confirm Row Level Security (RLS) is enabled

RLS is a database-level lock that, as a second layer of protection (on top of the app's own login check), keeps anyone without proper access from reading or writing your data directly.

1. In **Table Editor**, each table name in the left-hand table list shows a small shield icon or "RLS enabled" indicator next to it. Alternatively, click **Database** in the left sidebar → **Policies** — this page lists every table with RLS status and its policies.
2. Check `assessments`, `answers`, `documents`, `rule_evaluations`, `findings`, `reports`.

**PASS**: every one of those tables shows RLS as **enabled**, and each has at least one policy listed (they will all be named something like "admin full access to `<table>`" or "admin can read own profile").
**STOP if**: any table shows RLS as disabled, or has zero policies. This is a serious problem — it means that table's data would not be protected by the database itself. Do not proceed to a pilot; get developer help immediately.

### A5. Confirm the private document storage bucket

1. In the left sidebar, click **Storage**.
2. Find the bucket named `assessment-documents`.
3. Click it, then look for a "Public" indicator/toggle (usually near the bucket name or in its settings).

**PASS**: the bucket exists, and its "Public" setting is **off** (private).
**STOP if**: the bucket doesn't exist (migrations incomplete — see A2), or its Public toggle is **on**. If it's public, uploaded client documents could be reachable by anyone with the right URL — this must be turned off before any pilot or real use. Turn it off, or get developer help if the toggle isn't available to you.

### A6. Create/confirm your one attorney Auth account

This is the login you (the attorney) will use for `/admin`.

1. In the left sidebar, click **Authentication**, then the **Users** tab.
2. Check whether your email already appears in the user list.
   - **If it's already there**: note the value in its **UID** column (a long string like `a1b2c3d4-...`) — you'll need it in A8. Skip to A7.
   - **If it's not there**: click **Add user** (or **Invite**), choose **Create new user**, enter your email address and a strong password (or use "send invite link" if offered — follow its emailed instructions), and save. Note the new user's **UID** shown in the list afterward.

**PASS**: exactly one user exists in this list — yours. **STOP if**: you see any user in this list you don't recognize — do not proceed; that means someone else already has (or could get) access to this app's admin area. Investigate and remove/resolve that before continuing.

### A7. Ensure public sign-up is disabled

This stops anyone from creating their own login and getting into `/admin`.

1. Still under **Authentication**, click the **Providers** tab (or **Sign In / Providers**, depending on your dashboard version), then **Email**.
2. Find a toggle labeled something like **"Allow new users to sign up"** (sometimes located instead under **Authentication → Settings**, a general "Enable sign ups" toggle).
3. Turn it **off**, and save if there's a separate save button.

**PASS**: the toggle is off. **STOP if**: you can't find this setting anywhere in your dashboard version — search the Authentication section thoroughly before proceeding; do not skip this step. If you truly cannot locate it, get developer/Supabase-support help rather than proceeding without it.

### A8. Create/confirm the matching `admin_profiles` entry

This is a defense-in-depth database record — the app doesn't strictly require it to let you in today (see `PILOT_VALIDATION_PLAN.md` item 26 for why), but the database's own protections (A4) do rely on it, so it must exist.

1. Go to **Table Editor** → `admin_profiles`.
2. Check whether a row already exists with `id` equal to your UID from A6.
   - **If yes**: done, skip to Section B.
   - **If no**: click **Insert** → **Insert row**. Set `id` to your exact UID from A6, `display_name` to your name (e.g. "Attorney Name"), leave `created_at` on its default. Save.

**PASS**: exactly one row in `admin_profiles`, its `id` matching your Auth UID exactly.
**STOP if**: you're not sure your UID was copied correctly — go back to A6 and re-copy it precisely; a mismatched id makes this row useless.

---

## B. Required Environment Variables

These values connect the deployed app to your Supabase project. They must be set in **wherever the app is hosted/deployed** (e.g. Vercel, or another hosting platform) — not in Supabase itself, and not by pasting them anywhere in a chat with an AI assistant, ever.

If you don't personally have access to your hosting platform's settings, this section is for whoever does — hand it to them.

| Variable name | Where to find the value in Supabase | Public or secret? | Where it must be set |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project **Settings → API**, field "Project URL" | Public/client-safe | Deployment platform's environment variables |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Project **Settings → API**, field "anon" / "public" key | Public/client-safe (RLS from A4 is what makes this safe) | Deployment platform's environment variables |
| `SUPABASE_SERVICE_ROLE_KEY` | Project **Settings → API**, field "service_role" key | **Secret — server-only.** Never put this in any code, log, or client-visible setting. | Deployment platform's environment variables, marked as a **secret/server-only** variable if your platform distinguishes those |
| `ASSESSMENT_TOKEN_PEPPER` | Not from Supabase — you generate this yourself once, a random string 32+ characters long (a developer can produce one, e.g. via `openssl rand -base64 32`, or any password-generator tool set to 32+ characters) | **Secret — server-only.** Changing it later invalidates every previously-issued client assessment link. | Deployment platform's environment variables, server-only |
| `PILOT_SYNTHETIC_MODE_ENABLED` | Not from Supabase — you set this to the literal text `true` only for this pilot | Not a secret, but **must be `false` or unset for any deployment a real client could reach** | Deployment platform's environment variables |

**PASS condition for this whole section**: all five variables are set in the deployment platform, the app redeploys successfully, and `/admin/login` loads without an error page.
**STOP if**: the app shows a startup/configuration error mentioning any of these names — it means one is missing or malformed; re-check the exact spelling of the variable name (they are case-sensitive) and that no extra spaces were pasted in.

---

## C. Synthetic Pilot Mode — how it actually works

This section describes what the code does today, verified by re-reading it directly (not assumed). All of the following were checked and are true as of this document:

- **The environment flag that enables it**: `PILOT_SYNTHETIC_MODE_ENABLED`, set in Section B above.
- **It is disabled by default**: if this variable is unset, or set to anything other than the exact text `true`, synthetic mode is off. This is enforced twice — once to decide whether the pilot control even appears on screen, and again, independently, inside the server-side action that runs analysis (so even a manually crafted request can't bypass the on-screen hiding).
- **Where the pilot-only fixture control appears**: on the assessment detail page in `/admin`, in the "הרצת ניתוח" (Run Analysis) box, only once the assessment's status is "נשלח — ממתין לניתוח" (submitted, awaiting analysis) — and only when the flag above is `true`. It is an amber-bordered dropdown clearly labeled "תג פיקסצ'ר לפיילוט מבוקר בלבד — יש להשאיר ריק עבור לקוח אמיתי" ("pilot fixture tag, controlled pilot only — leave blank for a real client"), restricted to four fixed choices — free text is never accepted.
- **Which fixture must be selected for the first pilot**: `B-overtime-mismatch` — see §D below.
- **Synthetic-derived reports cannot be released to a client**: verified and, where it was found missing, fixed during this pass (see the safeguards table your developer/this session produced separately, `PILOT_VALIDATION_PLAN.md` §6b). Concretely: if any document in an assessment was analyzed using synthetic fixture data, the "Release" action is refused with an on-screen error, regardless of attorney approval, and every generated report (internal or client preview) carries a visible amber banner reading "⚠ דוח פיילוט — מבוסס על נתוני בדיקה סינתטיים" at the top.

**No discrepancy was found between what was originally promised for these protections and what the code actually does** — two of the seven safeguards checked (the environment gate, and the release-block) were missing before this pass and have been implemented and tested as part of it; the other five were already correctly in place. Full detail: `PILOT_VALIDATION_PLAN.md` §6b.

---

## D. First Browser Pilot

Do this only after Sections A, B, and C are all PASS.

### D1. Sign in as admin

Go to `/admin/login` and sign in with the account from A6.

**PASS**: you land on `/admin`, showing "יצירת מיפוי חדש" (create new assessment) and a list of assessments (empty, if this is the very first one).

### D2. Create the synthetic pilot assessment

1. In "שם העסק" (business name), enter `עסק פיילוט לדוגמה בע"מ` (or any clearly-fake name — never a real client's name).
2. Click "צור קישור מאובטח" (create secure link).

**PASS**: a green box appears showing a link starting with `/assessment/`. **Copy this link now — it is shown only once.**

### D3. Obtain/open the client assessment link

Paste the link from D2 into a **new private/incognito browser window** (simulating the client's own browser, separate from your signed-in admin session).

**PASS**: the window shows the start of the Hebrew, right-to-left questionnaire.

### D4. Complete the questionnaire with the exact synthetic answers

Answer every required (marked) question — any real value is fine for most of them — **except** these, which must be exactly as follows to exercise branching correctly:

| Question (visible text) | Required answer |
|---|---|
| "האם קיים הסכם עבודה בכתב עם כל העובדים?" | **לא** |
| "האם נמסרה לעובדים הודעה בכתב על תנאי העבודה?" | **לא** |
| "האם עובדים מבצעים שעות נוספות?" | **כן, באופן קבוע** |
| "כיצד משולמות שעות נוספות?" (appears after the above) | **רכיב שעות נוספות גלובלי** |
| "אם משולם רכיב שעות נוספות גלובלי — האם הוא מופיע כרכיב נפרד בתלוש?" (appears after the above) | **לא יודעת** |
| "האם מבוצעות הפרשות פנסיוניות לכל העובדים הזכאים לכך?" | **כן** |

**PASS**: each answer saves without an error indicator next to it.

### D5. Upload the exact synthetic pilot document

At the question "האם קיים הסכם עבודה בכתב עם כל העובדים?", a file-picker appears beneath it once you answer. Click "בחירת קובץ" and upload **any small PDF file** — its actual content does not matter for this pilot (the pilot uses a canned fixture, not real file reading), but it must genuinely be a PDF.

**PASS**: the upload area shows "הועלה בהצלחה" (uploaded successfully).

*(Optional, for a fuller pilot: also answer "כן" and upload a second small PDF at "האם ניתן להעלות דו״ח נוכחות של עובד אחד מחודש מייצג?" if it appears.)*

### D6. Submit

Answer any remaining required questions with any valid value, reach the review screen, and click the final submit button ("שליחה סופית").

**PASS**: the screen changes to a locked "השאלון כבר נשלח" (already submitted) confirmation.

### D7. Return to admin

Switch back to your original (admin) browser window and open the new assessment from the `/admin` list.

**PASS**: its status reads "נשלח — ממתין לניתוח".

### D8. Run analysis using the approved synthetic fixture

In the amber "הרצת ניתוח" box, select **`B-overtime-mismatch`** from the dropdown, click "הרצת ניתוח", and confirm.

**PASS**: the page reloads with status "בבדיקת עורך/ת דין".
**STOP if**: no amber box/dropdown is visible at all — see §C; `PILOT_SYNTHETIC_MODE_ENABLED` is not active in this deployment.

### D9. Inspect extracted facts

Scroll to "עובדות שחולצו" (extracted facts).

**PASS**: the section is non-empty — at least one row showing a fact key, a value, a source, and a confidence number.

### D10. Inspect the cross-check contradiction

Scroll to "הצלבות" (cross-checks).

**PASS**: at least one entry appears, describing a mismatch between the employment agreement's assumed overtime hours and the attendance record's actual hours.

### D11. Inspect generated findings

Scroll to "ממצאים" (findings).

**PASS**: multiple findings are listed, including one titled "היעדר מסמך תנאי עבודה" and at least one referencing the overtime component.

### D12. Inspect exposure score

For any finding, note its risk-level badge and the numeric "ציון סיכון" (risk score, out of 100), and its "רמת ודאות" (confidence, out of 4).

**PASS**: both a risk level/score and a confidence value are shown for every finding.

### D13. Perform attorney review

For each `CRITICAL`-marked finding still showing "טיוטה" (draft), click "אישור" (confirm) or "דחייה" (dismiss). For at least one finding, toggle "הצגה ללקוח" (show to client) on.

**PASS**: statuses update on screen immediately after each click, with no error banner.

### D14. Generate the report preview

Click "יצירת תצוגה מקדימה — דוח פנימי" and "יצירת תצוגה מקדימה — דוח ללקוח" in the "דוחות" (reports) section, then "צפייה" on each new row.

**PASS**: both open, and **both show the amber "⚠ דוח פיילוט" banner at the top.** The client one shows only the finding(s) you marked visible in D13; the internal one shows all of them, with Rule IDs.

### D15. Verify release is blocked because synthetic extraction was used

Every `CRITICAL` finding must be resolved (D13) before this step. Click "אישור מיפוי" (approve) — status changes to "אושר". Then click "שליחת דוח ללקוח" (send report to client) and confirm.

**PASS: this fails.** An error banner reads that release is blocked because synthetic test data was used; status stays "אושר", never reaching "דוח נשלח ללקוח".
**STOP if**: release instead succeeds. This is a safeguard failure — do not proceed to any further pilot activity, and do not invite a real client, until this is fixed.

### D16. Inspect the audit trail

Scroll to "יומן פעילות" (activity log).

**PASS**: it lists, in order, the link being opened, each answer saved, the document upload, the questionnaire submission, "ניתוח הורץ", one or more "ממצא נבדק" entries, "תצוגה מקדימה של דוח נוצרה" entries, and "המיפוי אושר" — with **no** "דוח נשלח ללקוח" entry (matching D15).

---

## E. Pilot Pass/Fail Checklist

Answer each as PASS or FAIL, in order. Stop at the first FAIL and do not continue down the list.

1. A1 — Supabase project found and accessible.
2. A2/A3 — All required tables present with expected columns.
3. A4 — RLS enabled with policies on every checked table.
4. A5 — `assessment-documents` bucket exists and is private.
5. A6 — Exactly one attorney Auth account exists.
6. A7 — Public sign-up is disabled.
7. A8 — `admin_profiles` row exists, id matches the Auth account.
8. B — All 5 environment variables set; app loads `/admin/login` without a config error.
9. D1 — Admin sign-in succeeds.
10. D2/D3 — Assessment created and its client link opens.
11. D4/D5/D6 — Questionnaire completed with the required answers, document uploaded, submission succeeds.
12. D8 — Run Analysis succeeds using the `B-overtime-mismatch` fixture.
13. D9 — Extracted facts are shown with provenance.
14. D10 — The overtime cross-check contradiction is shown.
15. D11 — Findings are generated, including the two named above.
16. D12 — Every finding shows a risk score/level and a confidence value.
17. D13 — Attorney review actions (confirm/dismiss/visible-to-client) all work.
18. D14 — Both report previews generate and both show the synthetic-data banner.
19. D15 — Release is correctly **blocked** with the synthetic-data error.
20. D16 — Audit trail shows the full expected sequence, with no release event.

**If every item above is PASS:**

```
ATTORNEY PILOT PASSED — READY TO PLAN REAL-DOCUMENT EXTRACTION
```

**If any item is FAIL:**

```
ATTORNEY PILOT FAILED — DO NOT PROCEED TO REAL CLIENT
```

---

## F. Real-Client Boundary

**A real client must NOT be invited yet — regardless of the checklist result above.**

Before a real client is invited, at minimum, all three of the following must be true:

1. **Item 25 resolved** — a real document-extraction provider (live AI or equivalent) must be wired in and verified. Today, this app can only read documents through the synthetic fixture path this pilot exercises — it cannot yet read a real client's real document at all.
2. **Item 26 resolved** — the app's authorization must be verified/tightened beyond "any authenticated Supabase user" to something scoped specifically to your attorney account(s), with that verification actually performed and documented (not just A6–A8 above, which is the minimum safe configuration under today's code, not a permanent fix).
3. **This controlled attorney pilot must PASS** (§E) — every item, no exceptions.

Passing this pilot means the deterministic pipeline, review workflow, and safeguards work correctly on synthetic data. It does **not** mean the system is ready to analyze a real client's real documents or handle real client data — those are the two items above.
