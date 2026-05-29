import { ConflictBlock, ParseResult, Resolution, ResolutionType, buildMergedContent } from './conflictParser';

export interface WebviewState {
  lines: string[];
  conflicts: ConflictBlock[];
  resolutions: Resolution[];
  totalConflicts: number;
  resolvedCount: number;
  progressPercent: number;
  isFullyResolved: boolean;
  yoursBranchName: string;
  theirsBranchName: string;
}

export class MergeDocument {
  private readonly _parseResult: ParseResult;
  private readonly _resolutions: Resolution[];

  constructor(parseResult: ParseResult) {
    this._parseResult = parseResult;
    this._resolutions = parseResult.conflicts.map(() => ({ type: 'unresolved' as ResolutionType }));
  }

  get conflicts(): ConflictBlock[] { return this._parseResult.conflicts; }
  get lines(): string[] { return this._parseResult.lines; }
  get totalConflicts(): number { return this._parseResult.conflicts.length; }

  get resolvedCount(): number {
    // line-selection counts as resolved even when nothing selected (= intentional skip)
    return this._resolutions.filter(r => r.type !== 'unresolved').length;
  }

  get isFullyResolved(): boolean {
    return this.resolvedCount === this.totalConflicts;
  }

  get progressPercent(): number {
    if (this.totalConflicts === 0) return 100;
    return Math.round((this.resolvedCount / this.totalConflicts) * 100);
  }

  resolve(index: number, type: ResolutionType, customLines?: string[]): void {
    if (index >= 0 && index < this._resolutions.length) {
      this._resolutions[index] = { type, customLines };
    }
  }

  resolveLines(
    index: number,
    yoursSelected: boolean[],
    theirsSelected: boolean[],
    yoursBelow?: boolean[],
    theirsBelow?: boolean[],
  ): void {
    if (index >= 0 && index < this._resolutions.length) {
      this._resolutions[index] = { type: 'line-selection', yoursSelected, theirsSelected, yoursBelow, theirsBelow };
    }
  }

  unresolve(index: number): void {
    if (index >= 0 && index < this._resolutions.length) {
      this._resolutions[index] = { type: 'unresolved' };
    }
  }

  getResolution(index: number): Resolution {
    return this._resolutions[index] ?? { type: 'unresolved' };
  }

  getMergedContent(): string {
    return buildMergedContent(
      this._parseResult.lines,
      this._parseResult.conflicts,
      this._resolutions,
      this._parseResult.endsWithNewline
    );
  }

  getWebviewState(): WebviewState {
    const firstConflict = this._parseResult.conflicts[0];
    return {
      lines: this._parseResult.lines,
      conflicts: this._parseResult.conflicts,
      resolutions: [...this._resolutions],
      totalConflicts: this.totalConflicts,
      resolvedCount: this.resolvedCount,
      progressPercent: this.progressPercent,
      isFullyResolved: this.isFullyResolved,
      yoursBranchName: firstConflict?.yoursBranch ?? 'Yours',
      theirsBranchName: firstConflict?.theirsBranch ?? 'Theirs',
    };
  }
}
