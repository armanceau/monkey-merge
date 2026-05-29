import { parseConflicts, hasConflictMarkers, buildMergedContent, extractBranchNames, serializeResult } from '../conflictParser';

// ── parseConflicts ────────────────────────────────────────────────────────────

describe('parseConflicts', () => {
  test('detects a simple single conflict', () => {
    const src = [
      'before',
      '<<<<<<< HEAD',
      'yours',
      '=======',
      'theirs',
      '>>>>>>> feature',
      'after',
    ].join('\n');

    const r = parseConflicts(src);
    expect(r.hasConflicts).toBe(true);
    expect(r.conflicts).toHaveLength(1);

    const c = r.conflicts[0];
    expect(c.index).toBe(0);
    expect(c.yoursBranch).toBe('HEAD');
    expect(c.theirsBranch).toBe('feature');
    expect(c.yoursLines).toEqual(['yours']);
    expect(c.theirsLines).toEqual(['theirs']);
    expect(c.startLine).toBe(1);
    expect(c.separatorLine).toBe(3);
    expect(c.endLine).toBe(5);
  });

  test('detects multiple conflicts and assigns sequential indices', () => {
    const src = [
      '<<<<<<< A',
      'y1',
      '=======',
      't1',
      '>>>>>>> B',
      'middle',
      '<<<<<<< A',
      'y2',
      '=======',
      't2',
      '>>>>>>> B',
    ].join('\n');

    const r = parseConflicts(src);
    expect(r.conflicts).toHaveLength(2);
    expect(r.conflicts[0].index).toBe(0);
    expect(r.conflicts[1].index).toBe(1);
    expect(r.conflicts[1].yoursLines).toEqual(['y2']);
  });

  test('handles multi-line yours/theirs blocks', () => {
    const src = [
      '<<<<<<< HEAD',
      'a', 'b', 'c',
      '=======',
      'x', 'y',
      '>>>>>>> branch',
    ].join('\n');

    const r = parseConflicts(src);
    expect(r.conflicts[0].yoursLines).toEqual(['a', 'b', 'c']);
    expect(r.conflicts[0].theirsLines).toEqual(['x', 'y']);
  });

  test('handles empty yours section', () => {
    const src = ['<<<<<<< HEAD', '=======', 'theirs', '>>>>>>> b'].join('\n');
    const r = parseConflicts(src);
    expect(r.conflicts[0].yoursLines).toEqual([]);
    expect(r.conflicts[0].theirsLines).toEqual(['theirs']);
  });

  test('handles empty theirs section', () => {
    const src = ['<<<<<<< HEAD', 'yours', '=======', '>>>>>>> b'].join('\n');
    const r = parseConflicts(src);
    expect(r.conflicts[0].yoursLines).toEqual(['yours']);
    expect(r.conflicts[0].theirsLines).toEqual([]);
  });

  test('returns hasConflicts=false for clean file', () => {
    const r = parseConflicts('just a normal file\nno conflicts');
    expect(r.hasConflicts).toBe(false);
    expect(r.conflicts).toHaveLength(0);
  });

  test('strips trailing branch label from <<<<<<< marker', () => {
    const src = ['<<<<<<< refs/heads/my-feature', '=======', '>>>>>>> origin/main'].join('\n');
    const r = parseConflicts(src);
    expect(r.conflicts[0].yoursBranch).toBe('refs/heads/my-feature');
    expect(r.conflicts[0].theirsBranch).toBe('origin/main');
  });

  test('preserves trailing newline flag', () => {
    const withNL    = '<<<<<<< A\n=======\n>>>>>>> B\n';
    const withoutNL = '<<<<<<< A\n=======\n>>>>>>> B';
    expect(parseConflicts(withNL).endsWithNewline).toBe(true);
    expect(parseConflicts(withoutNL).endsWithNewline).toBe(false);
  });

  test('correctly records all lines including surrounding context', () => {
    const src = 'top\n<<<<<<< A\ny\n=======\nt\n>>>>>>> B\nbottom';
    const r = parseConflicts(src);
    expect(r.lines[0]).toBe('top');
    expect(r.lines[r.lines.length - 1]).toBe('bottom');
  });

  test('parses 3-way conflict with ||||||| base section', () => {
    const src = [
      '<<<<<<< HEAD',
      'yours',
      '||||||| base',
      'base line',
      '=======',
      'theirs',
      '>>>>>>> feature',
    ].join('\n');

    const r = parseConflicts(src);
    expect(r.hasConflicts).toBe(true);
    const c = r.conflicts[0];
    expect(c.yoursLines).toEqual(['yours']);
    expect(c.baseLines).toEqual(['base line']);
    expect(c.theirsLines).toEqual(['theirs']);
    expect(c.baseLine).toBeDefined();
  });

  test('baseLines is undefined for 2-way conflicts', () => {
    const src = ['<<<<<<< HEAD', 'yours', '=======', 'theirs', '>>>>>>> b'].join('\n');
    const r = parseConflicts(src);
    expect(r.conflicts[0].baseLines).toBeUndefined();
  });
});

// ── extractBranchNames ────────────────────────────────────────────────────────

describe('extractBranchNames', () => {
  test('extracts branch names from markers', () => {
    const src = '<<<<<<< main\nyours\n=======\ntheirs\n>>>>>>> feature-branch';
    const { left, right } = extractBranchNames(src);
    expect(left).toBe('main');
    expect(right).toBe('feature-branch');
  });

  test('falls back to HEAD/THEIRS when no labels', () => {
    const { left, right } = extractBranchNames('clean file with no conflicts');
    expect(left).toBe('HEAD');
    expect(right).toBe('THEIRS');
  });
});

// ── serializeResult ───────────────────────────────────────────────────────────

describe('serializeResult', () => {
  const src = 'before\n<<<<<<< HEAD\nyours\n=======\ntheirs\n>>>>>>> feature\nafter';
  const { lines, conflicts, endsWithNewline } = parseConflicts(src);

  test('serializes resolved result correctly', () => {
    const out = serializeResult(lines, conflicts, [{ type: 'yours' }], endsWithNewline);
    expect(out).toBe('before\nyours\nafter');
  });

  test('keeps unresolved markers for unresolved conflicts', () => {
    const out = serializeResult(lines, conflicts, [{ type: 'unresolved' }], endsWithNewline);
    expect(out).toContain('<<<<<<<');
    expect(out).toContain('>>>>>>>');
  });
});

// ── hasConflictMarkers ────────────────────────────────────────────────────────

describe('hasConflictMarkers', () => {
  test('returns true when conflict markers present', () => {
    expect(hasConflictMarkers('<<<<<<< HEAD\n=======\n>>>>>>> b')).toBe(true);
  });

  test('returns false for clean content', () => {
    expect(hasConflictMarkers('normal code')).toBe(false);
  });

  test('does not false-positive on <<<< without space', () => {
    // The regex requires "<<<<<<< " (7 < + space)
    expect(hasConflictMarkers('<<<<<<<nospace')).toBe(false);
  });
});

// ── buildMergedContent ────────────────────────────────────────────────────────

describe('buildMergedContent', () => {
  const src = 'before\n<<<<<<< HEAD\nyours\n=======\ntheirs\n>>>>>>> feature\nafter';
  const { lines, conflicts, endsWithNewline } = parseConflicts(src);

  test('accept yours', () => {
    const r = buildMergedContent(lines, conflicts, [{ type: 'yours' }], endsWithNewline);
    expect(r).toBe('before\nyours\nafter');
  });

  test('accept theirs', () => {
    const r = buildMergedContent(lines, conflicts, [{ type: 'theirs' }], endsWithNewline);
    expect(r).toBe('before\ntheirs\nafter');
  });

  test('accept both (yours then theirs)', () => {
    const r = buildMergedContent(lines, conflicts, [{ type: 'both' }], endsWithNewline);
    expect(r).toBe('before\nyours\ntheirs\nafter');
  });

  test('accept both-reversed (theirs then yours)', () => {
    const r = buildMergedContent(lines, conflicts, [{ type: 'both-reversed' }], endsWithNewline);
    expect(r).toBe('before\ntheirs\nyours\nafter');
  });

  test('ignore removes conflict block entirely', () => {
    const r = buildMergedContent(lines, conflicts, [{ type: 'ignored' }], endsWithNewline);
    expect(r).toBe('before\nafter');
  });

  test('unresolved keeps raw markers', () => {
    const r = buildMergedContent(lines, conflicts, [{ type: 'unresolved' }], endsWithNewline);
    expect(r).toContain('<<<<<<<');
    expect(r).toContain('=======');
    expect(r).toContain('>>>>>>>');
  });

  test('custom resolution uses custom lines', () => {
    const r = buildMergedContent(lines, conflicts, [{ type: 'custom', customLines: ['custom'] }], endsWithNewline);
    expect(r).toBe('before\ncustom\nafter');
  });

  test('preserves trailing newline', () => {
    const srcNL = src + '\n';
    const { lines: lNL, conflicts: cNL, endsWithNewline: eNL } = parseConflicts(srcNL);
    const r = buildMergedContent(lNL, cNL, [{ type: 'yours' }], eNL);
    expect(r.endsWith('\n')).toBe(true);
  });

  test('multiple conflicts resolved independently', () => {
    const multiSrc = [
      'top',
      '<<<<<<< A', 'y1', '=======', 't1', '>>>>>>> B',
      'mid',
      '<<<<<<< A', 'y2', '=======', 't2', '>>>>>>> B',
      'bot',
    ].join('\n');
    const pr = parseConflicts(multiSrc);
    const r = buildMergedContent(
      pr.lines, pr.conflicts,
      [{ type: 'yours' }, { type: 'theirs' }],
      pr.endsWithNewline
    );
    expect(r).toBe('top\ny1\nmid\nt2\nbot');
  });

  test('line-selection: inline lines appear before below lines', () => {
    const src2 = '<<<<<<< HEAD\na\nb\n=======\nx\ny\n>>>>>>> feature';
    const pr = parseConflicts(src2);
    // a=inline, b=below, x=inline, y=not selected
    const r = buildMergedContent(pr.lines, pr.conflicts, [{
      type: 'line-selection',
      yoursSelected:  [true,  true],
      theirsSelected: [true,  false],
      yoursBelow:     [false, true],
      theirsBelow:    [false, false],
    }], pr.endsWithNewline);
    // Expected: a (inline), x (inline), b (below)
    expect(r).toBe('a\nx\nb');
  });

  test('line-selection: yoursBelow defaults to all-false when omitted', () => {
    const pr = parseConflicts(src);
    const r = buildMergedContent(pr.lines, pr.conflicts, [{
      type: 'line-selection',
      yoursSelected:  [true],
      theirsSelected: [false],
      // yoursBelow / theirsBelow omitted → treated as all false
    }], pr.endsWithNewline);
    expect(r).toBe('before\nyours\nafter');
  });
});
