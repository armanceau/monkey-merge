import { parseConflicts } from '../conflictParser';
import { MergeDocument } from '../mergeDocument';

const src = 'before\n<<<<<<< HEAD\nyours\n=======\ntheirs\n>>>>>>> feature\nafter';

function makeDoc() {
  return new MergeDocument(parseConflicts(src));
}

describe('MergeDocument', () => {
  test('starts with all conflicts unresolved', () => {
    const doc = makeDoc();
    expect(doc.resolvedCount).toBe(0);
    expect(doc.progressPercent).toBe(0);
    expect(doc.isFullyResolved).toBe(false);
  });

  test('resolving a conflict updates counters', () => {
    const doc = makeDoc();
    doc.resolve(0, 'yours');
    expect(doc.resolvedCount).toBe(1);
    expect(doc.progressPercent).toBe(100);
    expect(doc.isFullyResolved).toBe(true);
  });

  test('unresolving resets a conflict', () => {
    const doc = makeDoc();
    doc.resolve(0, 'theirs');
    doc.unresolve(0);
    expect(doc.resolvedCount).toBe(0);
    expect(doc.isFullyResolved).toBe(false);
  });

  test('getMergedContent reflects resolution', () => {
    const doc = makeDoc();
    doc.resolve(0, 'yours');
    expect(doc.getMergedContent()).toBe('before\nyours\nafter');
  });

  test('getWebviewState includes all expected fields', () => {
    const doc = makeDoc();
    const ws = doc.getWebviewState();
    expect(ws).toHaveProperty('lines');
    expect(ws).toHaveProperty('conflicts');
    expect(ws).toHaveProperty('resolutions');
    expect(ws).toHaveProperty('totalConflicts', 1);
    expect(ws).toHaveProperty('resolvedCount', 0);
    expect(ws).toHaveProperty('progressPercent', 0);
    expect(ws).toHaveProperty('isFullyResolved', false);
    expect(ws).toHaveProperty('yoursBranchName', 'HEAD');
    expect(ws).toHaveProperty('theirsBranchName', 'feature');
  });

  test('ignoring out-of-range indices is a no-op', () => {
    const doc = makeDoc();
    doc.resolve(99, 'yours');   // ignored
    doc.unresolve(99);          // ignored
    expect(doc.resolvedCount).toBe(0);
  });

  test('progressPercent is 100 for file with no conflicts', () => {
    const doc = new MergeDocument(parseConflicts('clean file'));
    expect(doc.progressPercent).toBe(100);
    expect(doc.isFullyResolved).toBe(true);
  });
});
