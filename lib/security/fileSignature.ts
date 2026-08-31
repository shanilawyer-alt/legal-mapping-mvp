/**
 * Server-side file-type sniffing by content, independent of whatever MIME
 * type the browser/client claims. A client can set `file.type`/the
 * `Content-Type` of a form part to anything it likes (the classic "rename
 * malware.exe to report.pdf" attack), so validation must not trust that
 * string alone — see lib/storage/validation.ts, which cross-checks the
 * declared type against what's sniffed here before accepting an upload.
 *
 * Deliberately conservative and pure-function based (no external
 * dependency): checks magic-byte signatures for binary formats, and a
 * not-binary heuristic for CSV, which has no magic bytes of its own.
 *
 * DOCX and XLSX are both ZIP-based OOXML containers with the same outer
 * signature — this module only confirms the upload is a genuine ZIP
 * archive (which already defeats "rename an arbitrary file to .docx").
 * Distinguishing a real Word document from an Excel workbook from an
 * arbitrary ZIP renamed to either extension requires looking at the
 * archive's internal entries, which lib/storage/validation.ts does via
 * lib/security/zipEntries.ts — see OPEN_QUESTIONS.md item 7.
 */

export type SniffedFileType = "pdf" | "png" | "jpeg" | "zip" | "text" | "unknown";

const SIGNATURES: ReadonlyArray<{ type: SniffedFileType; bytes: readonly number[] }> = [
  { type: "pdf", bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] }, // "%PDF-"
  { type: "png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { type: "jpeg", bytes: [0xff, 0xd8, 0xff] },
  { type: "zip", bytes: [0x50, 0x4b, 0x03, 0x04] }, // "PK\x03\x04" — local file header
];

const TEXT_SNIFF_WINDOW = 8192;

export function sniffFileType(data: Buffer): SniffedFileType {
  for (const signature of SIGNATURES) {
    if (matchesSignature(data, signature.bytes)) return signature.type;
  }
  if (looksLikeText(data)) return "text";
  return "unknown";
}

function matchesSignature(data: Buffer, bytes: readonly number[]): boolean {
  if (data.length < bytes.length) return false;
  for (let i = 0; i < bytes.length; i++) {
    if (data[i] !== bytes[i]) return false;
  }
  return true;
}

/**
 * Heuristic: a NUL byte anywhere in the sniff window is a strong binary
 * signal (real CSV/text content never contains one), and the window must
 * decode as valid UTF-8. Neither check is a formal CSV grammar validator —
 * that's intentionally out of scope here; this only needs to catch
 * "this isn't text at all."
 */
function looksLikeText(data: Buffer): boolean {
  if (data.length === 0) return false;
  const window = data.subarray(0, Math.min(data.length, TEXT_SNIFF_WINDOW));
  if (window.includes(0x00)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(window);
    return true;
  } catch {
    return false;
  }
}
