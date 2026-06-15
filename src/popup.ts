/*
 Popup DOM creation, positioning, and lifecycle.

 Two usage modes:
  - renderPopupDom(): builds the card element. Used by the CM6 hoverTooltip,
    which owns positioning + lifecycle itself.
  - showPopupAt() / destroyPopup(): imperative manager for the reading view,
    which positions a fixed popup near the cursor and handles close events.

 All colors come from Obsidian CSS variables (see styles.css). The only
 hardcoded values are the spec-mandated tone-color *fallbacks*, which sit
 inside var(--color-*, fallback) so a theme still wins.
*/

import { DictEntry } from "./dictionary";
import { toPinyinSyllables, TONE_COLOR_VARS } from "./pinyin";

export interface PopupOptions {
    showHSKLevel: boolean;
    showTraditional: boolean;
}

/** Count Chinese characters in a string (for the meta row). */
function charCount(s: string): number {
    return Array.from(s).length;
}

/** Register / domain tags CC-CEDICT puts in leading parentheses. */
const REGISTER_TAGS = new Set([
    "idiom", "coll.", "fig.", "lit.", "old", "dialect", "slang", "vulgar",
    "derog.", "honorific", "polite", "formal", "archaic", "abbr.", "onom.",
    "neologism", "euphemism", "loanword", "surname", "math.", "phys.",
    "chem.", "bio.", "med.", "comp.", "electr.", "mus.", "ling.", "gram.",
    "astron.", "geol.", "econ.", "law", "tw", "prc", "hk",
]);

// Embedded reference: optional "trad|simp" hanzi followed by [pinyin].
// Also matches a bare [pinyin] (e.g. "also pr. [di4]").
const REF_RE =
    /([㐀-鿿豈-﫿·|]+)?\[([A-Za-z0-9:·,\s]+)\]/g;

/** Append tone-colored pinyin syllables to `parent`, space-separated. */
function appendPinyin(parent: HTMLElement, raw: string, leadingSpace: boolean): void {
    const syls = toPinyinSyllables(raw);
    syls.forEach((syl, i) => {
        const span = parent.createSpan({ cls: `zhongwen-tone zhongwen-tone${syl.tone}` });
        span.setText((leadingSpace || i > 0 ? " " : "") + syl.text);
        span.setCssStyles({ color: TONE_COLOR_VARS[syl.tone] ?? "var(--text-normal)" });
    });
}

/** Render def text, styling embedded "汉字[pinyin]" refs and bare [pinyin]. */
function renderInlineRefs(parent: HTMLElement, text: string): void {
    REF_RE.lastIndex = 0;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = REF_RE.exec(text)) !== null) {
        if (m.index > last) parent.appendText(text.slice(last, m.index));
        const ref = parent.createSpan({ cls: "zhongwen-ref" });
        if (m[1]) {
            const forms = m[1].split("|");
            ref.createSpan({
                cls: "zhongwen-ref-hanzi",
                text: forms[forms.length - 1],
            });
            appendPinyin(ref, m[2], true);
        } else {
            appendPinyin(ref, m[2], false);
        }
        last = REF_RE.lastIndex;
    }
    if (last < text.length) parent.appendText(text.slice(last));
}

/** Render one definition sense: leading register badges + inline refs. */
function renderDefinitionInto(row: HTMLElement, text: string): void {
    let rest = text;
    let m: RegExpMatchArray | null;
    // Pull off leading "(tag)" groups that are recognized register tags.
    while ((m = rest.match(/^\(([^)]+)\)\s*/)) !== null) {
        const inner = m[1];
        const first = inner.split(/[\s;,]/)[0].toLowerCase();
        if (REGISTER_TAGS.has(first)) {
            row.createSpan({ cls: "zhongwen-tag", text: inner });
            rest = rest.slice(m[0].length);
        } else break;
    }
    renderInlineRefs(row, rest);
}

/** One classifier (measure word): its hanzi + raw numeric pinyin. */
interface Classifier {
    hanzi: string;
    pinyin: string;
}

/**
 * Parse a CC-CEDICT "CL:" sense (without the "CL:" prefix) into classifiers.
 * Forms: "家[jia1]", "個|个[ge4]" (trad|simp), comma-separated for several.
 */
function parseClassifiers(s: string): Classifier[] {
    const out: Classifier[] = [];
    for (const part of s.split(",")) {
        const m = part.trim().match(/^([^[]+)\[([^\]]+)\]$/);
        if (!m) continue;
        // Prefer the simplified form (after "|") when both are given.
        const forms = m[1].split("|");
        out.push({ hanzi: forms[forms.length - 1], pinyin: m[2] });
    }
    return out;
}

/** Render one entry block (header + defs) into `root`. */
function renderEntryBlock(root: HTMLElement, entry: DictEntry, opts: PopupOptions): void {
    // --- Header: hanzi + pinyin ---
    const header = root.createDiv({ cls: "zhongwen-popup-header" });

    const hanzi = header.createSpan({ cls: "zhongwen-popup-character" });
    hanzi.setText(entry.simplified);

    if (opts.showTraditional && entry.traditional !== entry.simplified) {
        const trad = header.createSpan({ cls: "zhongwen-popup-character zhongwen-popup-trad" });
        trad.setText(entry.traditional);
    }

    const pinyin = header.createSpan({ cls: "zhongwen-popup-pinyin" });
    for (const syl of toPinyinSyllables(entry.pinyin)) {
        const span = pinyin.createSpan({ cls: `zhongwen-tone zhongwen-tone${syl.tone}` });
        span.setText(syl.text + " ");
        span.setCssStyles({ color: TONE_COLOR_VARS[syl.tone] ?? "var(--text-normal)" });
    }

    root.createDiv({ cls: "zhongwen-popup-separator" });

    // --- Split real senses from classifier ("CL:") notes ---
    const senses: string[] = [];
    const classifiers: Classifier[] = [];
    for (const def of entry.definitions) {
        if (def.startsWith("CL:")) {
            classifiers.push(...parseClassifiers(def.slice(3)));
        } else {
            const parts = def.split(/;\s+(?![^(]*\))/);
            for (const p of parts) {
                const trimmed = p.trim();
                if (trimmed) senses.push(trimmed);
            }
        }
    }

    // --- Definitions (cap at 5) ---
    const defs = senses.slice(0, 5);
    defs.forEach((def, i) => {
        const row = root.createDiv({ cls: "zhongwen-popup-definition" });
        if (defs.length > 1) {
            row.createSpan({ cls: "zhongwen-popup-definition-number", text: `${i + 1}.` });
        }
        renderDefinitionInto(row, def);
    });

    // --- Measure word row ---
    if (classifiers.length) {
        const row = root.createDiv({ cls: "zhongwen-popup-measure" });
        row.createSpan({ cls: "zhongwen-popup-measure-label", text: "measure word" });
        classifiers.forEach((cl, i) => {
            const item = row.createSpan({ cls: "zhongwen-popup-measure-item" });
            if (i > 0) item.setText(", ");
            item.createSpan({ cls: "zhongwen-popup-measure-hanzi", text: cl.hanzi });
            const py = toPinyinSyllables(cl.pinyin);
            for (const syl of py) {
                const span = item.createSpan({ cls: `zhongwen-tone zhongwen-tone${syl.tone}` });
                span.setText(" " + syl.text);
                span.setCssStyles({ color: TONE_COLOR_VARS[syl.tone] ?? "var(--text-normal)" });
            }
        });
    }
}

/**
 * Build the popup card element for one or more entries (e.g. multiple
 * readings of 教). Pure DOM — no positioning, no global state.
 */
export function renderPopupDom(entries: DictEntry[], opts: PopupOptions): HTMLElement {
    const root = activeDocument.createElement("div");
    root.className = "zhongwen-popup";

    entries.forEach((entry, i) => {
        if (i > 0) {
            root.createDiv({ cls: "zhongwen-popup-entry-sep" });
        }
        renderEntryBlock(root, entry, opts);
    });

    // --- Meta row ---
    if (opts.showHSKLevel) {
        const n = charCount(entries[0].simplified);
        root.createDiv({
            cls: "zhongwen-popup-meta",
            text: `${n} character${n === 1 ? "" : "s"}`,
        });
    }

    // --- Save hint (saves first/primary entry) ---
    root.createDiv({ cls: "zhongwen-popup-hint", text: 'Press "S" to save' });

    return root;
}

// ---------------------------------------------------------------------------
// Imperative manager (reading view)
// ---------------------------------------------------------------------------

let currentPopup: HTMLElement | null = null;
let currentEntry: DictEntry | null = null;
let cleanup: (() => void) | null = null;
let highlightEl: HTMLElement | null = null;

/**
 * Highlight the matched characters by overlaying a themed box at `rects`
 * (client coords). Reuses one element across moves to avoid flicker.
 */
export function showHighlight(rects: DOMRectList | DOMRect[]): void {
    if (!highlightEl) {
        highlightEl = activeDocument.createElement("div");
        highlightEl.className = "zhongwen-highlight";
        activeDocument.body.appendChild(highlightEl);
    }
    highlightEl.empty();
    for (let i = 0; i < rects.length; i++) {
        const r = rects[i];
        const box = highlightEl.createDiv({ cls: "zhongwen-highlight-box" });
        box.setCssStyles({ left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    }
}

/** Remove the character highlight overlay. */
export function hideHighlight(): void {
    if (highlightEl) {
        highlightEl.remove();
        highlightEl = null;
    }
}

/** The entry currently shown in any popup (CM6 or reading view), for save. */
export function getCurrentEntry(): DictEntry | null {
    return currentEntry;
}

/** Let the CM6 path register/clear the active entry for the save shortcut. */
export function setCurrentEntry(entry: DictEntry | null): void {
    currentEntry = entry;
}

/** Tear down the imperative reading-view popup, if any. */
export function destroyPopup(): void {
    if (cleanup) {
        cleanup();
        cleanup = null;
    }
    if (currentPopup) {
        currentPopup.remove();
        currentPopup = null;
    }
    hideHighlight();
    currentEntry = null;
}

/**
 * Show a fixed-position popup near (x, y), flipping if it would overflow the
 * viewport. Closes on Escape, click outside, or scroll. Replaces any existing
 * imperative popup.
 */
export function showPopupAt(
    entries: DictEntry[],
    x: number,
    y: number,
    opts: PopupOptions
): void {
    destroyPopup();

    const dom = renderPopupDom(entries, opts);
    dom.setCssStyles({ position: "fixed", visibility: "hidden" });
    activeDocument.body.appendChild(dom);

    // Measure then position with flip + viewport clamp.
    // Use activeWindow (not window) so the popout window's viewport is used —
    // matches activeDocument.body above, else popup mis-positions in popouts.
    const rect = dom.getBoundingClientRect();
    const margin = 12;
    const win = activeDocument.defaultView ?? window;
    const vw = win.innerWidth;
    const vh = win.innerHeight;

    let left = x + margin;
    let top = y + margin;
    if (left + rect.width > vw) left = x - rect.width - margin; // flip left
    if (top + rect.height > vh) top = y - rect.height - margin; // flip up
    left = Math.max(4, Math.min(left, vw - rect.width - 4));
    top = Math.max(4, Math.min(top, vh - rect.height - 4));

    dom.setCssStyles({ left: `${left}px`, top: `${top}px`, visibility: "visible" });

    currentPopup = dom;
    currentEntry = entries[0];

    // --- close handlers ---
    const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") destroyPopup();
    };
    const onClick = (e: MouseEvent) => {
        if (currentPopup && !currentPopup.contains(e.target as Node)) {
            destroyPopup();
        }
    };
    const onScroll = () => destroyPopup();

    activeDocument.addEventListener("keydown", onKey, true);
    activeDocument.addEventListener("mousedown", onClick, true);
    win.addEventListener("scroll", onScroll, true);

    cleanup = () => {
        activeDocument.removeEventListener("keydown", onKey, true);
        activeDocument.removeEventListener("mousedown", onClick, true);
        win.removeEventListener("scroll", onScroll, true);
    };
}

/** Flash a "Saved ✓" confirmation inside whichever popup is visible. */
export function showSaveFeedback(): void {
    const popup =
        currentPopup ??
        activeDocument.querySelector<HTMLElement>(".zhongwen-popup");
    if (!popup) return;

    let badge = popup.querySelector<HTMLElement>(".zhongwen-popup-saved");
    if (!badge) {
        badge = popup.createDiv({ cls: "zhongwen-popup-saved", text: "Saved ✓" });
    }
    badge.classList.add("zhongwen-popup-saved-show");
    window.setTimeout(() => {
        badge?.classList.remove("zhongwen-popup-saved-show");
    }, 800);
}
