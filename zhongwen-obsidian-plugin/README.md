# Zhongwen — Chinese Popup Dictionary for Obsidian

Hover over Chinese text anywhere in Obsidian (editor or reading view) to see a
floating card with pinyin (tone-colored), CC-CEDICT definitions, and a save
shortcut. Same dictionary, segmentation, and UX as the
[Zhongwen browser extension](https://github.com/cschiller/zhongwen) — running
inside Obsidian.

## Files

| File | Purpose |
|------|---------|
| `manifest.json` | Obsidian plugin manifest. |
| `main.ts` | Entry point: loads dict data, registers editor + reading-view integrations, the `S` save shortcut, and the settings tab. |
| `styles.css` | Popup styling — 100% Obsidian CSS variables (theme-adaptive). Only literals are tone-color *fallbacks* inside `var(--color-*, fallback)`. |
| `src/dictionary.ts` | CC-CEDICT loader + lookup. Faithful port of Zhongwen's `ZhongwenDictionary` (binary-search index, greedy longest-match `wordSearch`). |
| `src/segmenter.ts` | Chinese segmentation: grabs the CJK window at the cursor and lets the dictionary's greedy match decide the word boundary (Zhongwen's actual strategy). |
| `src/pinyin.ts` | Numeric-pinyin → tone-mark conversion + tone→color mapping. Ported from `content.js`. |
| `src/popup.ts` | Popup DOM builder + imperative manager (fixed positioning, viewport flip, Escape / click-outside / scroll close, "Saved ✓" feedback). |
| `src/editor-extension.ts` | CodeMirror 6 `hoverTooltip` for the editor. |
| `src/reading-view.ts` | Markdown post-processor: wraps Chinese runs, hover-segments under the cursor via caret hit-testing. |
| `data/cedict_ts.u8` | CC-CEDICT dictionary text (copied from source). |
| `data/cedict.idx` | Sorted lookup index (`key,offset,…`). |
| `package.json` / `tsconfig.json` / `esbuild.config.mjs` | Build setup. |

### Why `.u8` + `.idx` instead of `cedict.json`

The original dictionary format (9 MB text + 3 MB index) is loaded **at runtime
from the plugin folder** via the vault adapter, so `main.js` stays ~24 KB
instead of bundling 12 MB. The `find`/`wordSearch` binary-search algorithm is
ported verbatim and operates directly on this format — converting to JSON would
add size with no benefit. This is the one deviation from the task spec.

## Build

```bash
npm install --legacy-peer-deps   # obsidian pins an exact @codemirror/state
npm run build                    # tsc type-check + esbuild bundle → main.js
```

`obsidian` and all `@codemirror/*` packages are externalized (provided by
Obsidian at runtime) — confirmed not bundled.

## Manual install into a vault

1. `npm run build`
2. Create `<vault>/.obsidian/plugins/zhongwen-obsidian/`
3. Copy into it: `main.js`, `manifest.json`, `styles.css`, and the whole
   `data/` folder (both `cedict_ts.u8` and `cedict.idx` — required at runtime).
4. Obsidian → Settings → Community plugins → enable **Zhongwen**.
5. Open a note with Chinese, e.g. `今天天气很好。我想学习中文。`
6. Hover characters → popup appears. Switch to Reading view → still works.
7. Press `S` while a popup is visible → word appended to the word-list note.
8. Toggle theme (light/dark/custom) → popup adapts automatically.

> Copy command (PowerShell), from the plugin dir:
> ```powershell
> $dst = "$env:APPDATA\obsidian\…"  # or <vault>/.obsidian/plugins/zhongwen-obsidian
> Copy-Item main.js,manifest.json,styles.css $dst
> Copy-Item data $dst -Recurse
> ```

## Settings

- **Word list note path** — where saved words go (default `Chinese/Word List`); folders auto-created.
- **Show meta row** — character count under definitions.
- **Show traditional character** — show traditional form when it differs.
- **Hover delay (ms)** — 100–800, editor view (applied live).
- **Enable in editor** / **Enable in reading view** — toggle each surface.

## Known limitations / edge cases

- **HSK level not available.** The Zhongwen source ships no HSK dataset (only
  grammar/vocab keyword lists), so the "Show meta row" toggle shows a
  **character count** instead of an HSK level. Wire in an HSK CSV later if
  needed.
- **Segmentation is greedy longest-match**, identical to Zhongwen — not a
  statistical segmenter. Occasional over/under-segmentation on ambiguous
  compounds is expected and matches the extension's behavior.
- **Editor `S` shortcut**: only fires when a popup is visible and no
  Ctrl/Cmd/Alt modifier is held (so Ctrl/Cmd+S still saves the file). If a
  hover tooltip is open in the editor while you type, an unmodified `S` is
  captured to save — move the mouse away to dismiss the tooltip first.
- **Caret hit-testing** in reading view uses `caretPositionFromPoint` /
  `caretRangeFromPoint`; on the rare engine without either, it falls back to
  segmenting from the start of the hovered run.
- **Mobile**: marked `isDesktopOnly: false` and uses no desktop-only APIs, but
  hover has no touch equivalent — reading-view spans would need tap handling
  for real mobile use.
- **Dict load is async** on plugin start; hovers no-op for the brief moment
  before `cedict_ts.u8` (9 MB) finishes loading.
- Definitions capped at 5 senses per entry (matches Zhongwen).

## Credits

Dictionary + lookup/pinyin logic ported from
[Zhongwen](https://github.com/cschiller/zhongwen) (GPL-2.0) by Christian
Schiller, itself based on Rikaikun / Rikaichan / RikaiXUL. CC-CEDICT by MDBG.
This plugin inherits **GPL-2.0**.
