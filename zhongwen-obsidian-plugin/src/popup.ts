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

/**
 * Build the popup card element for an entry. Pure DOM construction — no
 * positioning, no global state. Uses Obsidian-styled classes from styles.css.
 */
export function renderPopupDom(entry: DictEntry, opts: PopupOptions): HTMLElement {
    const root = document.createElement("div");
    root.className = "zhongwen-popup";

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
        // Inline fallback so it still colors correctly if styles.css missing.
        span.style.color = TONE_COLOR_VARS[syl.tone] ?? "var(--text-normal)";
    }

    root.createDiv({ cls: "zhongwen-popup-separator" });

    // --- Definitions (cap at 5, like Zhongwen) ---
    const defs = entry.definitions.slice(0, 5);
    defs.forEach((def, i) => {
        const row = root.createDiv({ cls: "zhongwen-popup-definition" });
        if (defs.length > 1) {
            row.createSpan({ cls: "zhongwen-popup-definition-number", text: `${i + 1}.` });
        }
        row.createSpan({ text: def });
    });

    // --- Meta row (character count; HSK dataset not bundled — see README) ---
    if (opts.showHSKLevel) {
        const n = charCount(entry.simplified);
        root.createDiv({
            cls: "zhongwen-popup-meta",
            text: `${n} character${n === 1 ? "" : "s"}`,
        });
    }

    // --- Save hint ---
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
        highlightEl = document.createElement("div");
        highlightEl.className = "zhongwen-highlight";
        document.body.appendChild(highlightEl);
        // hold child boxes for multi-rect (wrapped) ranges
    }
    highlightEl.empty();
    for (let i = 0; i < rects.length; i++) {
        const r = rects[i];
        const box = highlightEl.createDiv({ cls: "zhongwen-highlight-box" });
        box.style.left = `${r.left}px`;
        box.style.top = `${r.top}px`;
        box.style.width = `${r.width}px`;
        box.style.height = `${r.height}px`;
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
    entry: DictEntry,
    x: number,
    y: number,
    opts: PopupOptions
): void {
    destroyPopup();

    const dom = renderPopupDom(entry, opts);
    dom.style.position = "fixed";
    dom.style.visibility = "hidden";
    document.body.appendChild(dom);

    // Measure then position with flip + viewport clamp.
    const rect = dom.getBoundingClientRect();
    const margin = 12;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = x + margin;
    let top = y + margin;
    if (left + rect.width > vw) left = x - rect.width - margin; // flip left
    if (top + rect.height > vh) top = y - rect.height - margin; // flip up
    left = Math.max(4, Math.min(left, vw - rect.width - 4));
    top = Math.max(4, Math.min(top, vh - rect.height - 4));

    dom.style.left = `${left}px`;
    dom.style.top = `${top}px`;
    dom.style.visibility = "visible";

    currentPopup = dom;
    currentEntry = entry;

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

    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onClick, true);
    window.addEventListener("scroll", onScroll, true);

    cleanup = () => {
        document.removeEventListener("keydown", onKey, true);
        document.removeEventListener("mousedown", onClick, true);
        window.removeEventListener("scroll", onScroll, true);
    };
}

/** Flash a "Saved ✓" confirmation inside whichever popup is visible. */
export function showSaveFeedback(): void {
    const popup =
        currentPopup ??
        (document.querySelector(".zhongwen-popup") as HTMLElement | null);
    if (!popup) return;

    let badge = popup.querySelector(".zhongwen-popup-saved") as HTMLElement | null;
    if (!badge) {
        badge = popup.createDiv({ cls: "zhongwen-popup-saved", text: "Saved ✓" });
    }
    badge.classList.add("zhongwen-popup-saved-show");
    window.setTimeout(() => {
        badge?.classList.remove("zhongwen-popup-saved-show");
    }, 800);
}
