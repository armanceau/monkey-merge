import { ConflictBlock } from './conflictParser';

export interface SmartMergeResult {
  resolved: boolean;
  resultLines: string[];
  reason: string;
}

const IMPORT_RE = /^\s*(import\s+|import\s+static\s+|from\s+'|from\s+")/;

function isImportBlock(lines: string[]): boolean {
  return lines.length > 0 && lines.every(l => IMPORT_RE.test(l) || l.trim() === '');
}

function mergeImports(yours: string[], theirs: string[]): string[] {
  const combined = [...new Set([...yours, ...theirs])];
  return combined.sort();
}

export function trySmartMerge(conflict: ConflictBlock): SmartMergeResult {
  const yours  = conflict.yoursLines;
  const theirs = conflict.theirsLines;
  const base   = conflict.baseLines ?? [];

  // Rule 1: identical sides
  if (yours.join('\n') === theirs.join('\n')) {
    return { resolved: true, resultLines: [...yours], reason: 'Identical conflict — both sides match' };
  }

  // Rule 2: whitespace-only difference
  if (yours.map(l => l.trim()).join('\n') === theirs.map(l => l.trim()).join('\n')) {
    return { resolved: true, resultLines: [...yours], reason: 'Whitespace-only difference — using your version' };
  }

  // Rule 3: import deduplication
  if (isImportBlock(yours) && isImportBlock(theirs)) {
    return {
      resolved: true,
      resultLines: mergeImports(yours, theirs),
      reason: 'Import deduplication',
    };
  }

  // Rule 4: non-conflicting addition (one side added, the other didn't change)
  if (base.length > 0) {
    const yoursJoined  = yours.join('\n');
    const theirsJoined = theirs.join('\n');
    const baseJoined   = base.join('\n');

    if (yoursJoined === baseJoined && theirsJoined !== baseJoined) {
      return { resolved: true, resultLines: [...theirs], reason: 'Non-conflicting addition — accepting theirs' };
    }
    if (theirsJoined === baseJoined && yoursJoined !== baseJoined) {
      return { resolved: true, resultLines: [...yours], reason: 'Non-conflicting addition — accepting yours' };
    }
  }

  return { resolved: false, resultLines: [], reason: 'Complex conflict — manual resolution required' };
}
