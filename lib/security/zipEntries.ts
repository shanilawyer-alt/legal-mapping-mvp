/**
 * Dependency-free ZIP central-directory reader. Given a buffer that has
 * already sniffed as a genuine ZIP (lib/security/fileSignature.ts), this
 * lists the archive's entry names — nothing more. It never decompresses
 * any entry's payload; a filename in a central directory record is
 * stored as plain bytes regardless of the compression method used for
 * the entry's content, so listing names never requires inflating
 * anything.
 *
 * Used by lib/storage/validation.ts to distinguish a genuine DOCX/XLSX
 * (an OOXML container with specific expected internal entries) from an
 * arbitrary ZIP file renamed to .docx/.xlsx — see OPEN_QUESTIONS.md
 * item 7.
 */

const EOCD_SIGNATURE = 0x06054b50; // "PK\x05\x06"
const CENTRAL_DIR_SIGNATURE = 0x02014b50; // "PK\x01\x02"
const EOCD_FIXED_SIZE = 22;
const CENTRAL_DIR_HEADER_FIXED_SIZE = 46;
/** A ZIP comment (which trails the EOCD record) is at most 65535 bytes. */
const MAX_EOCD_COMMENT_SIZE = 65535;

/**
 * Returns every entry name in the archive's central directory, or `null`
 * if `data` isn't a well-formed ZIP (missing/corrupt End-Of-Central-
 * Directory record, a central directory entry with the wrong signature,
 * or any length field that would read past the buffer). Malformed input
 * is a validation failure for the caller to reject, not a bug to throw
 * on — see how lib/storage/validation.ts treats a `null` result.
 */
export function listZipEntryNames(data: Buffer): string[] | null {
  const eocdOffset = findEndOfCentralDirectory(data);
  if (eocdOffset === -1) return null;

  const totalEntries = data.readUInt16LE(eocdOffset + 10);
  const centralDirSize = data.readUInt32LE(eocdOffset + 12);
  const centralDirOffset = data.readUInt32LE(eocdOffset + 16);

  if (
    centralDirOffset > data.length ||
    centralDirOffset + centralDirSize > data.length ||
    centralDirOffset + centralDirSize > eocdOffset
  ) {
    return null;
  }

  const names: string[] = [];
  let cursor = centralDirOffset;

  for (let i = 0; i < totalEntries; i++) {
    if (cursor + CENTRAL_DIR_HEADER_FIXED_SIZE > data.length) return null;
    if (data.readUInt32LE(cursor) !== CENTRAL_DIR_SIGNATURE) return null;

    const nameLength = data.readUInt16LE(cursor + 28);
    const extraLength = data.readUInt16LE(cursor + 30);
    const commentLength = data.readUInt16LE(cursor + 32);

    const nameStart = cursor + CENTRAL_DIR_HEADER_FIXED_SIZE;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > data.length) return null;

    names.push(data.toString("utf-8", nameStart, nameEnd));
    cursor = nameEnd + extraLength + commentLength;
  }

  return names;
}

/**
 * Scans backward for the EOCD signature. It can be preceded by a variable-
 * length archive comment (up to 65535 bytes), so the signature is not
 * necessarily at a fixed offset from the end of the file.
 */
function findEndOfCentralDirectory(data: Buffer): number {
  if (data.length < EOCD_FIXED_SIZE) return -1;
  const searchStart = Math.max(0, data.length - EOCD_FIXED_SIZE - MAX_EOCD_COMMENT_SIZE);
  for (let i = data.length - EOCD_FIXED_SIZE; i >= searchStart; i--) {
    if (data.readUInt32LE(i) === EOCD_SIGNATURE) return i;
  }
  return -1;
}
