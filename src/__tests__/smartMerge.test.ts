import { trySmartMerge } from '../smartMerge';
import { ConflictBlock } from '../conflictParser';

function makeConflict(yours: string[], theirs: string[], base?: string[]): ConflictBlock {
  return {
    index: 0,
    startLine: 0,
    separatorLine: yours.length + 1,
    endLine: yours.length + theirs.length + 2,
    yoursBranch: 'HEAD',
    theirsBranch: 'feature',
    yoursLines: yours,
    theirsLines: theirs,
    baseLines: base,
  };
}

describe('SmartMerge', () => {
  test('resolves identical conflicts — takes yours', () => {
    const conflict = makeConflict(['same line'], ['same line']);
    const result = trySmartMerge(conflict);
    expect(result.resolved).toBe(true);
    expect(result.resultLines).toEqual(['same line']);
    expect(result.reason).toMatch(/identical/i);
  });

  test('resolves whitespace-only differences — takes yours', () => {
    const conflict = makeConflict(['  foo  '], ['foo']);
    const result = trySmartMerge(conflict);
    expect(result.resolved).toBe(true);
    expect(result.resultLines).toEqual(['  foo  ']);
    expect(result.reason).toMatch(/whitespace/i);
  });

  test('merges TypeScript import blocks — deduplicates and sorts', () => {
    const yours  = ["import { A } from 'mod';", "import { B } from 'mod';"];
    const theirs = ["import { A } from 'mod';", "import { C } from 'mod';"];
    const result = trySmartMerge(makeConflict(yours, theirs));
    expect(result.resolved).toBe(true);
    expect(result.resultLines).toContain("import { A } from 'mod';");
    expect(result.resultLines).toContain("import { B } from 'mod';");
    expect(result.resultLines).toContain("import { C } from 'mod';");
    // No duplicates
    const counts: Record<string, number> = {};
    for (const l of result.resultLines) { counts[l] = (counts[l] ?? 0) + 1; }
    expect(Object.values(counts).every(c => c === 1)).toBe(true);
    expect(result.reason).toMatch(/import/i);
  });

  test('merges Java import blocks', () => {
    const yours  = ['import java.util.List;'];
    const theirs = ['import java.util.Map;'];
    const result = trySmartMerge(makeConflict(yours, theirs));
    expect(result.resolved).toBe(true);
    expect(result.resultLines).toContain('import java.util.List;');
    expect(result.resultLines).toContain('import java.util.Map;');
  });

  test('resolves non-conflicting addition: theirs adds, yours unchanged (with base)', () => {
    const base   = ['original'];
    const yours  = ['original'];
    const theirs = ['original', 'new line'];
    const result = trySmartMerge(makeConflict(yours, theirs, base));
    expect(result.resolved).toBe(true);
    expect(result.resultLines).toEqual(['original', 'new line']);
    expect(result.reason).toMatch(/theirs/i);
  });

  test('resolves non-conflicting addition: yours adds, theirs unchanged (with base)', () => {
    const base   = ['original'];
    const yours  = ['original', 'new line'];
    const theirs = ['original'];
    const result = trySmartMerge(makeConflict(yours, theirs, base));
    expect(result.resolved).toBe(true);
    expect(result.resultLines).toEqual(['original', 'new line']);
    expect(result.reason).toMatch(/yours/i);
  });

  test('does NOT resolve true semantic conflicts', () => {
    const yours  = ['function foo() { return 1; }'];
    const theirs = ['function foo() { return 2; }'];
    const result = trySmartMerge(makeConflict(yours, theirs));
    expect(result.resolved).toBe(false);
    expect(result.resultLines).toHaveLength(0);
  });

  test('does NOT auto-resolve when both sides change differently vs base', () => {
    const base   = ['original'];
    const yours  = ['your change'];
    const theirs = ['their change'];
    const result = trySmartMerge(makeConflict(yours, theirs, base));
    expect(result.resolved).toBe(false);
  });
});
