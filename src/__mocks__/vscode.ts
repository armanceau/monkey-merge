// Minimal vscode mock for Jest
export const window = {
  showInformationMessage: jest.fn().mockResolvedValue(undefined),
  showWarningMessage: jest.fn().mockResolvedValue(undefined),
  showErrorMessage: jest.fn().mockResolvedValue(undefined),
  showTextDocument: jest.fn().mockResolvedValue(undefined),
  createWebviewPanel: jest.fn(),
  activeTextEditor: undefined,
};

export const workspace = {
  fs: {
    readFile: jest.fn(),
    writeFile: jest.fn(),
  },
  onDidOpenTextDocument: jest.fn(),
  textDocuments: [] as any[],
  getConfiguration: jest.fn(() => ({ get: jest.fn(() => true) })),
};

export const commands = {
  registerCommand: jest.fn(),
  executeCommand: jest.fn(),
};

export const Uri = {
  joinPath: jest.fn((...args: any[]) => ({ toString: () => args.join('/') })),
  file: jest.fn((p: string) => ({ fsPath: p, toString: () => p, scheme: 'file' })),
};

export const ViewColumn = { One: 1, Two: 2, Three: 3 };

export class EventEmitter {
  event = jest.fn();
  fire = jest.fn();
  dispose = jest.fn();
}
