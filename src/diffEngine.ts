export interface DiffToken {
  text: string;
  type: 'equal' | 'insert' | 'delete' | 'modify';
}

export interface LineDiff {
  leftTokens: DiffToken[];
  rightTokens: DiffToken[];
}

function buildLcsTable(a: string[], b: string[]): number[][] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp;
}

type Op = { type: 'equal' | 'insert' | 'delete'; value: string };

function computeOps(a: string[], b: string[], dp: number[][]): Op[] {
  const ops: Op[] = [];
  let i = a.length;
  let j = b.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      ops.unshift({ type: 'equal', value: a[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.unshift({ type: 'insert', value: b[j - 1] });
      j--;
    } else {
      ops.unshift({ type: 'delete', value: a[i - 1] });
      i--;
    }
  }
  return ops;
}

export function diffLines(left: string[], right: string[]): LineDiff[] {
  const dp = buildLcsTable(left, right);
  const ops = computeOps(left, right, dp);
  const result: LineDiff[] = [];

  let di = 0;
  while (di < ops.length) {
    const op = ops[di];
    if (op.type === 'equal') {
      result.push({
        leftTokens:  [{ text: op.value, type: 'equal' }],
        rightTokens: [{ text: op.value, type: 'equal' }],
      });
      di++;
    } else if (op.type === 'delete' && di + 1 < ops.length && ops[di + 1].type === 'insert') {
      const { leftTokens, rightTokens } = diffWords(op.value, ops[di + 1].value);
      result.push({ leftTokens, rightTokens });
      di += 2;
    } else if (op.type === 'delete') {
      result.push({
        leftTokens:  [{ text: op.value, type: 'delete' }],
        rightTokens: [],
      });
      di++;
    } else {
      result.push({
        leftTokens:  [],
        rightTokens: [{ text: op.value, type: 'insert' }],
      });
      di++;
    }
  }

  return result;
}

export function diffWords(
  left: string,
  right: string,
): { leftTokens: DiffToken[]; rightTokens: DiffToken[] } {
  const tokenize = (s: string): string[] =>
    s.split(/(\b|\s+|[^\w\s])/).filter(t => t.length > 0);

  const lToks = tokenize(left);
  const rToks = tokenize(right);
  const dp = buildLcsTable(lToks, rToks);
  const ops = computeOps(lToks, rToks, dp);

  const leftTokens: DiffToken[] = [];
  const rightTokens: DiffToken[] = [];

  for (const op of ops) {
    switch (op.type) {
      case 'equal':
        leftTokens.push({ text: op.value, type: 'equal' });
        rightTokens.push({ text: op.value, type: 'equal' });
        break;
      case 'delete':
        leftTokens.push({ text: op.value, type: 'delete' });
        break;
      case 'insert':
        rightTokens.push({ text: op.value, type: 'insert' });
        break;
    }
  }

  return { leftTokens, rightTokens };
}
