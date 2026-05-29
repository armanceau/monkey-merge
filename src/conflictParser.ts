export interface ConflictBlock {
  index: number;
  startLine: number;      // 0-indexed line of <<<<<<<
  baseLine?: number;      // 0-indexed line of ||||||| (3-way only)
  separatorLine: number;  // 0-indexed line of =======
  endLine: number;        // 0-indexed line of >>>>>>>
  yoursBranch: string;    // label from <<<<<<< LABEL
  theirsBranch: string;   // label from >>>>>>> LABEL
  yoursLines: string[];
  baseLines?: string[];   // lines between ||||||| and ======= (3-way only)
  theirsLines: string[];
}

export interface ParseResult {
  conflicts: ConflictBlock[];
  lines: string[];
  hasConflicts: boolean;
  endsWithNewline: boolean;
}

export type ResolutionType = 'unresolved' | 'yours' | 'theirs' | 'both' | 'both-reversed' | 'ignored' | 'custom' | 'line-selection';

export interface Resolution {
  type: ResolutionType;
  customLines?: string[];
  yoursSelected?: boolean[];   // per-line flags, only for line-selection
  theirsSelected?: boolean[];  // per-line flags, only for line-selection
  yoursBelow?: boolean[];      // per-line: append at end of result instead of in-position
  theirsBelow?: boolean[];     // per-line: append at end of result instead of in-position
}

const YOURS_RE     = /^<{7} ?(.*)$/;
const BASE_RE      = /^\|{7} ?(.*)$/;
const SEPARATOR_RE = /^={7}\s*$/;
const THEIRS_RE    = /^>{7} ?(.*)$/;

export function parseConflicts(content: string): ParseResult {
  const endsWithNewline = content.endsWith('\n');
  const rawLines = content.split('\n');
  // Keep the trailing empty string if present — joining back produces same content
  const lines = rawLines;

  const conflicts: ConflictBlock[] = [];
  let i = 0;
  let conflictIndex = 0;

  while (i < lines.length) {
    const yoursMatch = lines[i].match(YOURS_RE);
    if (!yoursMatch) { i++; continue; }

    const startLine = i;
    const yoursBranch = yoursMatch[1].trim() || 'HEAD';
    const yoursLines: string[] = [];
    i++;

    while (i < lines.length && !SEPARATOR_RE.test(lines[i]) && !BASE_RE.test(lines[i])) {
      if (YOURS_RE.test(lines[i]) || THEIRS_RE.test(lines[i])) { i++; break; }
      yoursLines.push(lines[i]);
      i++;
    }

    // Optional 3-way base section (||||||| ... =======)
    let baseLine: number | undefined;
    let baseLines: string[] | undefined;

    if (i < lines.length && BASE_RE.test(lines[i])) {
      baseLine = i;
      baseLines = [];
      i++;
      while (i < lines.length && !SEPARATOR_RE.test(lines[i])) {
        if (YOURS_RE.test(lines[i]) || THEIRS_RE.test(lines[i])) { i++; break; }
        baseLines.push(lines[i]);
        i++;
      }
    }

    if (i >= lines.length || !SEPARATOR_RE.test(lines[i])) continue;

    const separatorLine = i;
    const theirsLines: string[] = [];
    i++;

    while (i < lines.length && !THEIRS_RE.test(lines[i])) {
      if (YOURS_RE.test(lines[i]) || SEPARATOR_RE.test(lines[i])) { i++; break; }
      theirsLines.push(lines[i]);
      i++;
    }

    if (i >= lines.length || !THEIRS_RE.test(lines[i])) continue;

    const endLine = i;
    const theirsMatch = lines[i].match(THEIRS_RE);
    const theirsBranch = theirsMatch?.[1].trim() || 'THEIRS';

    conflicts.push({
      index: conflictIndex++,
      startLine,
      baseLine,
      separatorLine,
      endLine,
      yoursBranch,
      theirsBranch,
      yoursLines,
      baseLines,
      theirsLines,
    });

    i++;
  }

  return { conflicts, lines, hasConflicts: conflicts.length > 0, endsWithNewline };
}

export function hasConflictMarkers(content: string): boolean {
  return /^<{7} /m.test(content);
}

export function extractBranchNames(content: string): { left: string; right: string } {
  const yoursMatch  = content.match(/^<{7} (.+)$/m);
  const theirsMatch = content.match(/^>{7} (.+)$/m);
  return {
    left:  yoursMatch?.[1].trim()  ?? 'HEAD',
    right: theirsMatch?.[1].trim() ?? 'THEIRS',
  };
}

export function serializeResult(
  lines: string[],
  conflicts: ConflictBlock[],
  resolutions: Resolution[],
  endsWithNewline: boolean
): string {
  return buildMergedContent(lines, conflicts, resolutions, endsWithNewline);
}

export function buildMergedContent(
  lines: string[],
  conflicts: ConflictBlock[],
  resolutions: Resolution[],
  endsWithNewline: boolean
): string {
  const out: string[] = [];
  let lineIndex = 0;

  for (const conflict of conflicts) {
    while (lineIndex < conflict.startLine) {
      out.push(lines[lineIndex++]);
    }

    const resolution = resolutions[conflict.index] ?? { type: 'unresolved' };

    switch (resolution.type) {
      case 'yours':
        out.push(...conflict.yoursLines);
        break;
      case 'theirs':
        out.push(...conflict.theirsLines);
        break;
      case 'both':
        out.push(...conflict.yoursLines, ...conflict.theirsLines);
        break;
      case 'both-reversed':
        out.push(...conflict.theirsLines, ...conflict.yoursLines);
        break;
      case 'ignored':
        break;
      case 'custom':
        if (resolution.customLines) out.push(...resolution.customLines);
        break;
      case 'line-selection': {
        const yoursBelow  = resolution.yoursBelow  ?? [];
        const theirsBelow = resolution.theirsBelow ?? [];
        // Inline lines first (selected and NOT marked below)
        conflict.yoursLines.forEach((l, i) => {
          if (resolution.yoursSelected?.[i] && !yoursBelow[i]) out.push(l);
        });
        conflict.theirsLines.forEach((l, i) => {
          if (resolution.theirsSelected?.[i] && !theirsBelow[i]) out.push(l);
        });
        // Below lines appended after all inline content
        conflict.yoursLines.forEach((l, i) => {
          if (resolution.yoursSelected?.[i] && yoursBelow[i]) out.push(l);
        });
        conflict.theirsLines.forEach((l, i) => {
          if (resolution.theirsSelected?.[i] && theirsBelow[i]) out.push(l);
        });
        break;
      }
      default:
        // Keep raw markers for unresolved
        out.push(lines[conflict.startLine]);
        out.push(...conflict.yoursLines);
        out.push(lines[conflict.separatorLine]);
        out.push(...conflict.theirsLines);
        out.push(lines[conflict.endLine]);
    }

    lineIndex = conflict.endLine + 1;
  }

  while (lineIndex < lines.length) {
    out.push(lines[lineIndex++]);
  }

  const joined = out.join('\n');
  // Preserve original trailing-newline behaviour
  if (endsWithNewline && !joined.endsWith('\n')) return joined + '\n';
  if (!endsWithNewline && joined.endsWith('\n')) return joined.slice(0, -1);
  return joined;
}
