# CLAUDE.md — IntelliJ Merge Editor Clone for VSCode

> **Ce fichier est un prompt opérationnel pour Claude Code.**  
> Suis chaque section dans l'ordre. Ne saute aucune étape. Valide chaque phase avant de passer à la suivante.

---

## 🎯 Objectif du projet

Créer une extension VSCode qui **remplace et améliore** l'éditeur de merge natif de VSCode par un clone fidèle du **Merge Editor IntelliJ IDEA**.

L'extension doit implémenter une **vue 3 colonnes simultanées** (Left / Center / Result / Right) avec :

- Un panneau central **entièrement éditable**
- Des **flèches visuelles interactives** pour accepter/rejeter des blocs
- Une **synchronisation du scroll** entre les 3 panneaux
- Un **code couleur** clair (vert/rouge/bleu/gris)
- Une **navigation fluide** entre les conflits
- Un **smart merge** pour les conflits simples

---

## 📁 Structure du projet à générer

```
intellij-merge-editor/
├── CLAUDE.md                        ← ce fichier
├── package.json
├── tsconfig.json
├── .vscodeignore
├── README.md
├── CHANGELOG.md
├── src/
│   ├── extension.ts                 ← point d'entrée
│   ├── mergeEditorProvider.ts       ← CustomEditorProvider principal
│   ├── conflictParser.ts            ← parsing des marqueurs git
│   ├── mergeDocument.ts             ← modèle de données
│   ├── smartMerge.ts                ← logique smart merge
│   ├── diffEngine.ts                ← moteur de diff ligne par ligne
│   └── utils.ts
├── media/
│   ├── mergeEditor.js               ← logique webview (vanilla JS)
│   ├── mergeEditor.css              ← styles + thème IntelliJ
│   └── icons/
│       ├── arrow-left.svg
│       ├── arrow-right.svg
│       ├── arrow-both.svg
│       └── reject.svg
└── test/
    ├── suite/
    │   ├── conflictParser.test.ts
    │   ├── diffEngine.test.ts
    │   └── smartMerge.test.ts
    └── fixtures/
        ├── simple-conflict.txt
        ├── multi-conflict.txt
        └── complex-conflict.txt
```

---

## 🔧 Phase 1 — Setup du projet

### 1.1 `package.json`

```json
{
  "name": "intellij-merge-editor",
  "displayName": "IntelliJ Merge Editor",
  "description": "3-way merge editor inspired by IntelliJ IDEA — with editable center panel, visual arrows, and smart conflict resolution",
  "version": "0.1.0",
  "engines": { "vscode": "^1.85.0" },
  "categories": ["Other"],
  "activationEvents": [],
  "main": "./out/extension.js",
  "contributes": {
    "customEditors": [
      {
        "viewType": "intellijMerge.mergeEditor",
        "displayName": "IntelliJ Merge Editor",
        "selector": [{ "filenamePattern": "*.conflict" }],
        "priority": "option"
      }
    ],
    "commands": [
      {
        "command": "intellijMerge.openMergeEditor",
        "title": "Open IntelliJ Merge Editor",
        "category": "IntelliJ Merge"
      },
      {
        "command": "intellijMerge.nextConflict",
        "title": "Next Conflict",
        "category": "IntelliJ Merge"
      },
      {
        "command": "intellijMerge.prevConflict",
        "title": "Previous Conflict",
        "category": "IntelliJ Merge"
      },
      {
        "command": "intellijMerge.acceptAllLeft",
        "title": "Accept All Left",
        "category": "IntelliJ Merge"
      },
      {
        "command": "intellijMerge.acceptAllRight",
        "title": "Accept All Right",
        "category": "IntelliJ Merge"
      }
    ],
    "keybindings": [
      {
        "command": "intellijMerge.nextConflict",
        "key": "alt+down",
        "when": "intellijMergeEditorActive"
      },
      {
        "command": "intellijMerge.prevConflict",
        "key": "alt+up",
        "when": "intellijMergeEditorActive"
      }
    ],
    "menus": {
      "editor/title": [
        {
          "command": "intellijMerge.openMergeEditor",
          "when": "resourceScheme == git-merge",
          "group": "navigation"
        }
      ]
    },
    "configuration": {
      "title": "IntelliJ Merge Editor",
      "properties": {
        "intellijMerge.smartMerge": {
          "type": "boolean",
          "default": true,
          "description": "Automatically resolve simple conflicts (imports, formatting)"
        },
        "intellijMerge.syncScroll": {
          "type": "boolean",
          "default": true,
          "description": "Synchronize scroll position across all 3 panels"
        },
        "intellijMerge.showLineNumbers": {
          "type": "boolean",
          "default": true,
          "description": "Show line numbers in all panels"
        },
        "intellijMerge.highlightMode": {
          "type": "string",
          "enum": ["line", "word", "char"],
          "default": "word",
          "description": "Granularity of diff highlighting"
        },
        "intellijMerge.replaceNativeEditor": {
          "type": "boolean",
          "default": false,
          "description": "Automatically replace VSCode's native merge editor"
        }
      }
    }
  },
  "scripts": {
    "vscode:prepublish": "npm run compile",
    "compile": "tsc -p ./",
    "watch": "tsc -watch -p ./",
    "pretest": "npm run compile",
    "test": "node ./out/test/runTest.js"
  },
  "devDependencies": {
    "@types/vscode": "^1.85.0",
    "@types/node": "^20.0.0",
    "@types/mocha": "^10.0.0",
    "typescript": "^5.3.0",
    "@vscode/test-electron": "^2.3.0",
    "mocha": "^10.2.0"
  },
  "dependencies": {
    "diff": "^5.1.0"
  }
}
```

### 1.2 `tsconfig.json`

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2020",
    "outDir": "./out",
    "lib": ["ES2020"],
    "sourceMap": true,
    "rootDir": "./src",
    "strict": true
  },
  "exclude": ["node_modules", ".vscode-test"]
}
```

---

## 🧩 Phase 2 — Modèle de données (`mergeDocument.ts`)

Implémente les interfaces TypeScript suivantes **exactement** :

```typescript
export type ConflictStatus =
  | "unresolved"
  | "accepted-left"
  | "accepted-right"
  | "accepted-both"
  | "manual"
  | "ignored";

export interface ConflictBlock {
  id: string; // ex: "conflict-0", "conflict-1"
  startLine: number; // ligne de début dans le fichier original
  endLine: number; // ligne de fin dans le fichier original
  leftLines: string[]; // lignes de la version locale (Current)
  rightLines: string[]; // lignes de la version distante (Incoming)
  baseLines: string[]; // lignes de base (si disponibles — merge 3-way)
  resultLines: string[]; // lignes du résultat (éditable)
  status: ConflictStatus;
  isAutoResolved: boolean; // true si smart merge a résolu automatiquement
}

export interface MergeDocument {
  uri: string;
  leftLabel: string; // ex: "Current (main)"
  rightLabel: string; // ex: "Incoming (feature)"
  blocks: DocumentBlock[]; // alternance de blocs normaux et conflits
  totalConflicts: number;
  resolvedConflicts: number;
}

export type DocumentBlock =
  | { type: "text"; lines: string[]; startLine: number }
  | { type: "conflict"; conflict: ConflictBlock };
```

---

## 🔍 Phase 3 — Parser de conflits (`conflictParser.ts`)

### Règles de parsing

Le parser doit gérer les formats git suivants :

**Format 2-way (standard) :**

```
<<<<<<< HEAD (ou <<<<<<< CURRENT)
[lignes locales]
=======
[lignes distantes]
>>>>>>> feature-branch (ou >>>>>>> INCOMING)
```

**Format 3-way (avec base) :**

```
<<<<<<< HEAD
[lignes locales]
||||||| base
[lignes de base]
=======
[lignes distantes]
>>>>>>> feature-branch
```

### Interface à implémenter

```typescript
export function parseConflicts(content: string): MergeDocument;
export function serializeResult(doc: MergeDocument): string;
export function extractBranchNames(content: string): {
  left: string;
  right: string;
};
```

### Comportement attendu

1. Parcourir le fichier ligne par ligne
2. Détecter `<<<<<<<` → début d'un conflit
3. Détecter `|||||||` → fin de la section LEFT, début de BASE (optionnel)
4. Détecter `=======` → séparateur LEFT/RIGHT
5. Détecter `>>>>>>>` → fin du conflit
6. Les lignes hors conflits sont des blocs `type: 'text'`
7. Assigner un ID unique à chaque conflit : `conflict-0`, `conflict-1`, etc.
8. `resultLines` est initialisé **vide** (l'utilisateur construit le résultat)

---

## ⚙️ Phase 4 — Moteur de diff (`diffEngine.ts`)

Implémente un diff **ligne par ligne** et **mot par mot** pour calculer les surlignages intra-ligne.

```typescript
export interface DiffToken {
  text: string;
  type: "equal" | "insert" | "delete" | "modify";
}

export interface LineDiff {
  leftTokens: DiffToken[];
  rightTokens: DiffToken[];
}

// Diff entre deux tableaux de lignes
export function diffLines(left: string[], right: string[]): LineDiff[];

// Diff intra-ligne (word-level)
export function diffWords(
  left: string,
  right: string,
): {
  leftTokens: DiffToken[];
  rightTokens: DiffToken[];
};
```

**Algorithme** : utilise la librairie `diff` (déjà dans les dépendances). Pour le diff mot par mot, tokenise sur `\b` (word boundaries).

---

## 🧠 Phase 5 — Smart Merge (`smartMerge.ts`)

Le smart merge tente de résoudre automatiquement les conflits simples.

```typescript
export interface SmartMergeResult {
  resolved: boolean;
  resultLines: string[];
  reason: string; // ex: "Import deduplication", "Whitespace-only difference"
}

export function trySmartMerge(conflict: ConflictBlock): SmartMergeResult;
```

### Règles de résolution automatique (dans l'ordre)

1. **Conflit identique** : LEFT === RIGHT → prendre l'une ou l'autre
2. **Différence d'espacement uniquement** : trim() identique → prendre LEFT
3. **Import Java/TypeScript** : les deux ajoutent des imports → merger les deux (dédupliqué, trié)
4. **Ajout non-conflictuel** : l'un ajoute des lignes, l'autre ne modifie pas → accepter l'ajout
5. **Conflit complexe** : `resolved: false` → laisser à l'utilisateur

---

## 🖥️ Phase 6 — Extension principale (`extension.ts`)

```typescript
import * as vscode from "vscode";
import { MergeEditorProvider } from "./mergeEditorProvider";

export function activate(context: vscode.ExtensionContext) {
  // Enregistrer le CustomEditorProvider
  context.subscriptions.push(MergeEditorProvider.register(context));

  // Commande principale : intercepter l'ouverture des fichiers en conflit
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "intellijMerge.openMergeEditor",
      async (uri?: vscode.Uri) => {
        if (!uri) {
          uri = vscode.window.activeTextEditor?.document.uri;
        }
        if (!uri) return;

        await vscode.commands.executeCommand(
          "vscode.openWith",
          uri,
          "intellijMerge.mergeEditor",
        );
      },
    ),
  );

  // Auto-intercept : si replaceNativeEditor est activé, surveiller les ouvertures
  const config = vscode.workspace.getConfiguration("intellijMerge");
  if (config.get("replaceNativeEditor")) {
    context.subscriptions.push(
      vscode.workspace.onDidOpenTextDocument(async (doc) => {
        if (doc.getText().includes("<<<<<<<")) {
          await vscode.commands.executeCommand(
            "intellijMerge.openMergeEditor",
            doc.uri,
          );
        }
      }),
    );
  }
}

export function deactivate() {}
```

---

## 🏗️ Phase 7 — MergeEditorProvider (`mergeEditorProvider.ts`)

C'est le **cœur de l'extension**. Implémente `vscode.CustomTextEditorProvider`.

### Structure obligatoire

```typescript
export class MergeEditorProvider implements vscode.CustomTextEditorProvider {

  public static readonly viewType = 'intellijMerge.mergeEditor';

  public static register(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new MergeEditorProvider(context);
    return vscode.window.registerCustomEditorProvider(
      MergeEditorProvider.viewType,
      provider,
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false
      }
    );
  }

  constructor(private readonly context: vscode.ExtensionContext) {}

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    // 1. Configurer la webview
    // 2. Parser le document
    // 3. Appliquer le smart merge si activé
    // 4. Envoyer les données initiales à la webview
    // 5. Gérer les messages de la webview (actions utilisateur)
    // 6. Écouter les changements du document
  }

  // Méthodes privées
  private getHtmlForWebview(webview: vscode.Webview): string { ... }
  private applyEdit(document: vscode.TextDocument, doc: MergeDocument): void { ... }
  private handleWebviewMessage(message: WebviewMessage, document: vscode.TextDocument, doc: MergeDocument): void { ... }
}
```

### Messages Webview → Extension

```typescript
type WebviewMessage =
  | { type: "acceptLeft"; conflictId: string }
  | { type: "acceptRight"; conflictId: string }
  | {
      type: "acceptBoth";
      conflictId: string;
      order: "left-first" | "right-first";
    }
  | { type: "reject"; conflictId: string }
  | { type: "resultEdited"; conflictId: string; lines: string[] }
  | { type: "saveDocument" }
  | { type: "navigateConflict"; direction: "next" | "prev" }
  | { type: "ready" };
```

### Messages Extension → Webview

```typescript
type ExtensionMessage =
  | { type: "init"; document: MergeDocument; settings: MergeSettings }
  | { type: "updateConflict"; conflictId: string; conflict: ConflictBlock }
  | { type: "focusConflict"; conflictId: string }
  | { type: "settings"; settings: MergeSettings };
```

---

## 🎨 Phase 8 — Interface Webview (`media/mergeEditor.js` + `media/mergeEditor.css`)

### 8.1 Layout HTML (généré dynamiquement dans `getHtmlForWebview`)

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="${cssUri}" />
    <title>Merge Editor</title>
  </head>
  <body>
    <!-- Toolbar -->
    <div id="toolbar">
      <div id="toolbar-left">
        <span id="label-left" class="branch-label"></span>
      </div>
      <div id="toolbar-center">
        <button id="btn-prev-conflict" title="Previous conflict (Alt+↑)">
          ↑
        </button>
        <span id="conflict-counter">0 / 0 conflicts</span>
        <button id="btn-next-conflict" title="Next conflict (Alt+↓)">↓</button>
        <button id="btn-apply" class="btn-primary">Apply</button>
      </div>
      <div id="toolbar-right">
        <span id="label-right" class="branch-label"></span>
      </div>
    </div>

    <!-- Column headers -->
    <div id="column-headers">
      <div class="col-header" id="header-left">
        <span class="col-title">Local Changes</span>
        <span class="col-subtitle" id="subtitle-left"></span>
      </div>
      <div class="col-header col-header-gutter-left"></div>
      <div class="col-header" id="header-center">
        <span class="col-title">Result</span>
        <span class="col-subtitle">Editable</span>
      </div>
      <div class="col-header col-header-gutter-right"></div>
      <div class="col-header" id="header-right">
        <span class="col-title">Incoming Changes</span>
        <span class="col-subtitle" id="subtitle-right"></span>
      </div>
    </div>

    <!-- Main 3-panel view -->
    <div id="merge-container">
      <!-- Left panel (read-only) -->
      <div id="panel-left" class="merge-panel panel-left">
        <div class="panel-content" id="content-left"></div>
      </div>

      <!-- Left gutter (arrows Left→Center) -->
      <div id="gutter-left" class="gutter">
        <canvas id="canvas-left"></canvas>
      </div>

      <!-- Center panel (EDITABLE) -->
      <div id="panel-center" class="merge-panel panel-center">
        <div class="panel-content" id="content-center"></div>
      </div>

      <!-- Right gutter (arrows Right→Center) -->
      <div id="gutter-right" class="gutter">
        <canvas id="canvas-right"></canvas>
      </div>

      <!-- Right panel (read-only) -->
      <div id="panel-right" class="merge-panel panel-right">
        <div class="panel-content" id="content-right"></div>
      </div>
    </div>

    <script src="${jsUri}"></script>
  </body>
</html>
```

### 8.2 CSS — Thème IntelliJ (`media/mergeEditor.css`)

Le CSS doit reproduire fidèlement le thème sombre d'IntelliJ. Variables obligatoires :

```css
:root {
  /* Fond général */
  --bg-editor: #2b2b2b;
  --bg-panel: #2b2b2b;
  --bg-gutter: #313335;
  --bg-toolbar: #3c3f41;
  --bg-header: #3c3f41;

  /* Texte */
  --text-primary: #a9b7c6;
  --text-secondary: #6a8759;
  --text-line-number: #606366;

  /* Conflits — couleurs IntelliJ */
  --conflict-left-bg: rgba(71, 97, 71, 0.4); /* vert sombre */
  --conflict-left-bg-active: rgba(71, 97, 71, 0.7); /* vert actif */
  --conflict-left-border: #4a7c4a;
  --conflict-left-inline: rgba(98, 151, 85, 0.3); /* vert inline */

  --conflict-right-bg: rgba(71, 85, 120, 0.4); /* bleu sombre */
  --conflict-right-bg-active: rgba(71, 85, 120, 0.7);
  --conflict-right-border: #4a6fa5;
  --conflict-right-inline: rgba(106, 135, 189, 0.3); /* bleu inline */

  --conflict-delete-bg: rgba(115, 55, 55, 0.4); /* rouge sombre */
  --conflict-delete-inline: rgba(188, 63, 60, 0.3); /* rouge inline */

  --conflict-result-bg: rgba(60, 63, 65, 0.6);
  --conflict-result-border: #5a8a7a;

  /* Conflit actif (focus) */
  --active-conflict-outline: 1px solid #6897bb;

  /* Gutters / flèches */
  --arrow-left-color: #629755; /* vert */
  --arrow-right-color: #6897bb; /* bleu */
  --arrow-both-color: #ffc66d; /* orange */
  --reject-color: #cc6666; /* rouge */
  --arrow-hover: rgba(255, 255, 255, 0.1);

  /* Boutons */
  --btn-primary-bg: #4c7a4c;
  --btn-primary-hover: #5a8f5a;
  --btn-secondary-bg: #4c5052;
  --btn-border: #5a5a5a;

  /* Bordures */
  --border-color: #555;
  --border-panel: #444;

  /* Scroll sync indicator */
  --scrollbar-bg: #3c3f41;
  --scrollbar-thumb: #5a5a5a;

  /* Polices */
  --font-editor:
    "JetBrains Mono", "Fira Code", "Cascadia Code", "Consolas", monospace;
  --font-ui: -apple-system, "Segoe UI", sans-serif;
  --font-size: 13px;
  --line-height: 20px;
}
```

**Styles critiques à implémenter :**

1. **Layout flex** : les 3 panneaux + 2 gutters en `display: flex` horizontal, hauteur 100vh moins toolbar
2. **Panneaux** : `flex: 1 1 0`, overflow scroll, police monospace
3. **Gutters** : `width: 40px`, `flex-shrink: 0`, position relative pour le canvas des connexions
4. **Lignes normales** : fond `var(--bg-panel)`, numéros de ligne en gris
5. **Blocs conflits** :
   - LEFT : fond `var(--conflict-left-bg)` + border-left `3px solid var(--conflict-left-border)`
   - RIGHT : fond `var(--conflict-right-bg)` + border-right `3px solid var(--conflict-right-border)`
   - CENTER (result) : fond `var(--conflict-result-bg)` + bordures des deux côtés
6. **Conflit actif** : `outline: var(--active-conflict-outline)` + fond légèrement plus intense
7. **Diff inline** : `<span class="diff-token-add">` en vert, `<span class="diff-token-del">` en rouge, `<span class="diff-token-mod">` en bleu
8. **Boutons flèches** dans le gutter : `position: absolute`, centrés sur la hauteur du bloc conflit
9. **Panel center** : `contenteditable` sur les blocs de conflit seulement, curseur `text`

### 8.3 JavaScript Webview (`media/mergeEditor.js`)

Implémente les fonctions suivantes. **Utilise uniquement du vanilla JS** (pas de framework).

#### État global

```javascript
let state = {
  document: null, // MergeDocument
  activeConflictId: null, // ID du conflit actif
  activeConflictIndex: 0, // index numérique
  totalConflicts: 0,
  settings: {},
};
```

#### Fonctions obligatoires

```javascript
// Initialisation
function init(document, settings) { ... }

// Rendu
function renderAll() { ... }
function renderPanel(panelId, blocks, side) { ... }  // side: 'left'|'center'|'right'
function renderBlock(block, side) { ... }            // retourne un HTMLElement
function renderConflictBlock(conflict, side) { ... } // retourne un HTMLElement

// Diff inline
function applyInlineDiff(element, tokens) { ... }
function buildDiffTokens(leftLines, rightLines) { ... }

// Connexions visuelles (canvas dans les gutters)
function drawConnections() { ... }
function drawConflictConnection(canvas, conflictId, side) { ... }

// Boutons d'action (dans les gutters)
function renderGutterButtons(conflictId, side) { ... }
function createActionButton(icon, label, onClick) { ... }

// Actions utilisateur
function acceptLeft(conflictId) { ... }
function acceptRight(conflictId) { ... }
function acceptBoth(conflictId, order) { ... }
function rejectConflict(conflictId) { ... }
function updateResultFromEdit(conflictId, newContent) { ... }

// Navigation
function focusConflict(conflictId) { ... }
function navigateConflict(direction) { ... }   // 'next' | 'prev'
function scrollToConflict(conflictId) { ... }  // scroll synchronisé

// Synchronisation du scroll
function setupSyncScroll() { ... }
function syncScrollPosition(sourcePanel, scrollTop) { ... }

// Communication avec l'extension
function postMessage(message) { ... }
function handleMessage(message) { ... }  // reçoit les messages de l'extension

// Sauvegarde
function saveDocument() { ... }
function updateCounter() { ... }  // met à jour "X / Y conflicts"
```

#### Comportement des boutons dans les gutters

**Gutter gauche** (entre LEFT et CENTER) :

- Bouton `→` (flèche droite verte) : `acceptLeft(conflictId)` — injecte la version locale dans le résultat
- Bouton `×` (croix rouge) : `rejectConflict(conflictId)` depuis la gauche

**Gutter droit** (entre CENTER et RIGHT) :

- Bouton `←` (flèche gauche bleue) : `acceptRight(conflictId)` — injecte la version distante dans le résultat
- Bouton `⇄` (double flèche orange) : `acceptBoth(conflictId, 'left-first')` — combine les deux
- Bouton `×` (croix rouge) : `rejectConflict(conflictId)` depuis la droite

#### Connexions visuelles (canvas)

Pour chaque conflit résolu ou actif, dessiner sur le canvas du gutter :

- Un trapèze ou des lignes de connexion reliant le bloc LEFT au bloc CENTER (ou RIGHT au CENTER)
- Couleur selon le statut : vert (accepted-left), bleu (accepted-right), orange (accepted-both), rouge (rejected)
- Si non résolu : ligne pointillée grise

#### Édition du panneau central

- Les blocs de texte normaux : **non éditables**
- Les blocs de conflit dans le panneau center : `contenteditable="true"`
- À chaque modification (`input` event), capturer le contenu et envoyer `resultEdited` à l'extension
- Désactiver `contenteditable` une fois le conflit résolu (mais permettre une re-ouverture)

#### Synchronisation du scroll

```javascript
function setupSyncScroll() {
  const panels = ["panel-left", "panel-center", "panel-right"];
  let isSyncing = false;

  panels.forEach((panelId) => {
    document.getElementById(panelId).addEventListener("scroll", (e) => {
      if (isSyncing) return;
      if (!state.settings.syncScroll) return;
      isSyncing = true;
      const scrollTop = e.target.scrollTop;
      panels.forEach((otherId) => {
        if (otherId !== panelId) {
          document.getElementById(otherId).scrollTop = scrollTop;
        }
      });
      // Redessiner les connexions
      drawConnections();
      isSyncing = false;
    });
  });
}
```

---

## ✅ Phase 9 — Tests

### Fixtures de test (`test/fixtures/`)

**`simple-conflict.txt`** :

```
import java.util.List;

public record Book(String title) {
<<<<<<< HEAD
    List<String> authors,
    String publisher,
=======
    List<String> authors,
    String isbn,
>>>>>>> feature
}
```

**`multi-conflict.txt`** : fichier avec 3 conflits imbriqués

**`complex-conflict.txt`** : conflit avec section `|||||||` (format 3-way)

### Tests à implémenter

```typescript
// conflictParser.test.ts
describe("ConflictParser", () => {
  it("should parse a simple 2-way conflict");
  it("should parse multiple conflicts in one file");
  it("should parse a 3-way conflict with base section");
  it("should extract branch names from markers");
  it("should handle files with no conflicts");
  it("should serialize result back to file content");
});

// diffEngine.test.ts
describe("DiffEngine", () => {
  it("should detect added lines");
  it("should detect deleted lines");
  it("should detect modified lines");
  it("should produce word-level diff tokens");
});

// smartMerge.test.ts
describe("SmartMerge", () => {
  it("should resolve identical conflicts");
  it("should resolve whitespace-only differences");
  it("should merge Java import blocks");
  it("should NOT resolve true semantic conflicts");
});
```

---

## 🚀 Phase 10 — Intégration Git (avancée)

Après avoir validé les phases 1-9, implémenter :

### 10.1 Interception des fichiers en conflit git

```typescript
// Dans extension.ts
// Surveiller les fichiers ayant des marqueurs de conflit
// et proposer automatiquement l'ouverture dans notre éditeur
```

### 10.2 Commande `git-merge` URI handler

Intercepter le scheme `git-merge://` utilisé par VSCode pour les merges.

### 10.3 Intégration SCM

Après résolution complète (0 conflits restants), marquer le fichier comme résolu dans le Source Control Manager :

```typescript
await vscode.commands.executeCommand("git.stage", document.uri);
```

---

## 📋 Checklist de validation par phase

Avant de passer à la phase suivante, valide chaque point :

### Phase 1-2 (Setup + Data Model)

- [ ] `npm install` sans erreur
- [ ] `npm run compile` sans erreur TypeScript
- [ ] Toutes les interfaces TypeScript sont définies

### Phase 3 (Parser)

- [ ] Parse correctement `simple-conflict.txt`
- [ ] Parse correctement `multi-conflict.txt`
- [ ] Parse correctement `complex-conflict.txt`
- [ ] `serializeResult()` produit un fichier valide

### Phase 4-5 (Diff + SmartMerge)

- [ ] Tests unitaires passent
- [ ] Smart merge résout les imports Java/TS

### Phase 6-7 (Extension + Provider)

- [ ] L'extension s'active sans erreur
- [ ] La webview s'ouvre sur F5 (debug)
- [ ] Les messages bidirectionnels fonctionnent

### Phase 8 (UI Webview)

- [ ] Les 3 panneaux s'affichent côte à côte
- [ ] Les couleurs correspondent au thème IntelliJ
- [ ] Les boutons flèches apparaissent sur chaque conflit
- [ ] `acceptLeft` injecte le bon contenu dans CENTER
- [ ] `acceptRight` injecte le bon contenu dans CENTER
- [ ] `acceptBoth` combine les deux versions
- [ ] L'édition directe dans CENTER fonctionne
- [ ] Le scroll est synchronisé entre les 3 panneaux
- [ ] Les connexions visuelles (canvas) sont dessinées
- [ ] Le compteur de conflits se met à jour

### Phase 9 (Tests)

- [ ] `npm test` passe sans erreur

### Phase 10 (Git integration)

- [ ] L'extension s'active sur les fichiers en conflit git
- [ ] `git.stage` est appelé après résolution complète

---

## ⚠️ Contraintes et règles absolues

1. **Ne jamais modifier les panneaux LEFT et RIGHT** — ils sont strictement read-only
2. **Le panneau CENTER est la source de vérité** — c'est lui qui est sauvegardé
3. **Les numéros de ligne** doivent correspondre entre les 3 panneaux (même hauteur de ligne)
4. **Le scroll synchronisé** ne doit pas créer de boucle infinie (flag `isSyncing`)
5. **Les connexions canvas** doivent être redessinées à chaque scroll et resize
6. **Utiliser `vscode.WorkspaceEdit`** pour toutes les modifications du document — ne jamais écrire directement
7. **Le webview doit fonctionner** sans accès réseau (`localResourceRoots` configuré)
8. **Sécurité webview** : `enableScripts: true` mais `nonce` sur tous les scripts inline

---

## 🎨 Design Reference

Reproduire fidèlement l'interface visible dans la capture d'écran `screen.jpg` :

- Fond sombre `#2b2b2b` (IntelliJ Darcula)
- Titres de colonnes : "Changes from **main**" / "Result" / "Changes from **feature**"
- Boutons `Accept Left` / `Accept Right` en bas
- Compteur de conflits en haut au centre
- Flèches `→` et `←` dans les gutters avec les icônes `× »` visibles dans la capture
- Lignes de connexion entre les blocs correspondants

---

## 📝 Notes pour Claude Code

- **Commence par la Phase 1** et génère tous les fichiers dans l'ordre
- **Génère des fichiers complets** — pas de `// TODO` laissés vides
- **Si une dépendance manque**, ajoute-la dans `package.json` et explique pourquoi
- **Le CSS est aussi important que le TS** — le design doit être pixel-perfect vs la référence IntelliJ
- **Teste chaque phase** avec les fixtures avant de continuer
- **Commit message suggéré** par phase : `feat(phase-N): description`
