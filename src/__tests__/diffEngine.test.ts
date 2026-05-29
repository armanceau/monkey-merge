import { diffLines, diffWords } from '../diffEngine';

describe('diffLines', () => {
  test('detects added lines', () => {
    const result = diffLines([], ['added']);
    expect(result).toHaveLength(1);
    expect(result[0].leftTokens).toHaveLength(0);
    expect(result[0].rightTokens[0].type).toBe('insert');
    expect(result[0].rightTokens[0].text).toBe('added');
  });

  test('detects deleted lines', () => {
    const result = diffLines(['deleted'], []);
    expect(result).toHaveLength(1);
    expect(result[0].rightTokens).toHaveLength(0);
    expect(result[0].leftTokens[0].type).toBe('delete');
    expect(result[0].leftTokens[0].text).toBe('deleted');
  });

  test('detects equal lines', () => {
    const result = diffLines(['same'], ['same']);
    expect(result).toHaveLength(1);
    expect(result[0].leftTokens[0].type).toBe('equal');
    expect(result[0].rightTokens[0].type).toBe('equal');
  });

  test('detects modified lines (paired delete+insert becomes word diff)', () => {
    const result = diffLines(['hello world'], ['hello earth']);
    expect(result).toHaveLength(1);
    const leftText = result[0].leftTokens.map(t => t.text).join('');
    const rightText = result[0].rightTokens.map(t => t.text).join('');
    expect(leftText).toContain('world');
    expect(rightText).toContain('earth');
  });

  test('handles multiple lines with mixed operations', () => {
    const left  = ['a', 'b', 'c'];
    const right = ['a', 'x', 'c'];
    const result = diffLines(left, right);
    expect(result.some(d => d.leftTokens[0]?.type === 'equal' && d.leftTokens[0]?.text === 'a')).toBe(true);
    expect(result.some(d => d.leftTokens[0]?.type === 'equal' && d.leftTokens[0]?.text === 'c')).toBe(true);
  });

  test('returns empty array for two empty arrays', () => {
    expect(diffLines([], [])).toHaveLength(0);
  });

  test('produces word-level diff tokens for modified lines', () => {
    const result = diffLines(['foo bar'], ['foo baz']);
    const allLeftTypes  = result.flatMap(d => d.leftTokens.map(t => t.type));
    const allRightTypes = result.flatMap(d => d.rightTokens.map(t => t.type));
    expect(allLeftTypes).toContain('delete');
    expect(allRightTypes).toContain('insert');
    expect(allLeftTypes).toContain('equal');
  });
});

describe('diffWords', () => {
  test('equal strings produce only equal tokens', () => {
    const { leftTokens, rightTokens } = diffWords('hello', 'hello');
    expect(leftTokens.every(t => t.type === 'equal')).toBe(true);
    expect(rightTokens.every(t => t.type === 'equal')).toBe(true);
  });

  test('entirely different strings mark left as delete and right as insert', () => {
    const { leftTokens, rightTokens } = diffWords('abc', 'xyz');
    expect(leftTokens.some(t => t.type === 'delete')).toBe(true);
    expect(rightTokens.some(t => t.type === 'insert')).toBe(true);
  });

  test('partial change keeps common tokens equal', () => {
    const { leftTokens, rightTokens } = diffWords('hello world', 'hello earth');
    const leftEqual  = leftTokens.filter(t => t.type === 'equal').map(t => t.text).join('');
    const rightEqual = rightTokens.filter(t => t.type === 'equal').map(t => t.text).join('');
    expect(leftEqual).toContain('hello');
    expect(rightEqual).toContain('hello');
    expect(leftTokens.some(t => t.type === 'delete' && t.text === 'world')).toBe(true);
    expect(rightTokens.some(t => t.type === 'insert' && t.text === 'earth')).toBe(true);
  });

  test('reconstructing text from tokens round-trips correctly', () => {
    const left  = 'foo bar baz';
    const right = 'foo qux baz';
    const { leftTokens, rightTokens } = diffWords(left, right);
    const rebuiltLeft  = leftTokens.map(t => t.text).join('');
    const rebuiltRight = rightTokens.map(t => t.text).join('');
    expect(rebuiltLeft).toBe(left);
    expect(rebuiltRight).toBe(right);
  });
});
