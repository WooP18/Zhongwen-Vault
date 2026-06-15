/*
 Reading-view (rendered Markdown) integration.

 Walk text nodes, wrap runs of Chinese characters in a hoverable span, and on
 hover segment the word *under the mouse* (via caret hit-testing) so multi-char
 runs resolve the correct word, then show the imperative popup.
*/

import { MarkdownPostProcessorContext } from "obsidian";
import { ZhongwenDictionary } from "./dictionary";
import { segmentAtPos, isChineseChar } from "./segmenter";
import {
    showPopupAt,
    destroyPopup,
    showHighlight,
    PopupOptions,
} from "./popup";

export interface ReadingProvider {
    getDict(): ZhongwenDictionary | null;
    getOptions(): PopupOptions;
}

// Matches CJK Unified (incl. Ext A), Compatibility Ideographs, Ext B (surrogate
// pairs via the u-flag class), and ○.
const CHINESE_RUN = /[㐀-鿿豈-﫿○]+|[\u{20000}-\u{2FA1F}]+/gu;

/** Char offset within `text` at client point (x,y), or 0 if unavailable. */
function offsetAtPoint(textNode: Node, x: number, y: number): number {
    const doc = textNode.ownerDocument as Document & {
        caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
        caretRangeFromPoint?: (x: number, y: number) => Range | null;
    };
    if (doc.caretPositionFromPoint) {
        const p = doc.caretPositionFromPoint(x, y);
        if (p && p.offsetNode === textNode) return p.offset;
    }
    if (doc.caretRangeFromPoint) {
        const r = doc.caretRangeFromPoint(x, y);
        if (r && r.startContainer === textNode) return r.startOffset;
    }
    return 0;
}

export function makeReadingProcessor(provider: ReadingProvider) {
    return (el: HTMLElement, _ctx: MarkdownPostProcessorContext) => {
        // Per-panel state: isolated so multiple reading panels don't interfere.
        const panelState: { activeKey: string | null } = { activeKey: null };
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        const textNodes: Text[] = [];
        let node: Node | null;
        while ((node = walker.nextNode())) {
            // Skip code blocks / inline code — leave source untouched.
            const parent = (node as Text).parentElement;
            if (parent && parent.closest("code, pre")) continue;
            textNodes.push(node as Text);
        }

        for (const textNode of textNodes) {
            const text = textNode.textContent ?? "";
            CHINESE_RUN.lastIndex = 0;
            if (!CHINESE_RUN.test(text)) continue;
            CHINESE_RUN.lastIndex = 0;

            const frag = document.createDocumentFragment();
            let lastIndex = 0;
            let match: RegExpExecArray | null;

            while ((match = CHINESE_RUN.exec(text)) !== null) {
                if (match.index > lastIndex) {
                    frag.appendChild(
                        document.createTextNode(text.slice(lastIndex, match.index))
                    );
                }
                const span = document.createElement("span");
                span.className = "zhongwen-hoverable";
                span.textContent = match[0];
                attachHover(span, provider, panelState);
                frag.appendChild(span);
                lastIndex = CHINESE_RUN.lastIndex;
            }
            if (lastIndex < text.length) {
                frag.appendChild(document.createTextNode(text.slice(lastIndex)));
            }
            textNode.replaceWith(frag);
        }
    };
}

function attachHover(
    span: HTMLSpanElement,
    provider: ReadingProvider,
    panelState: { activeKey: string | null }
): void {
    const show = (e: MouseEvent) => {
        const dict = provider.getDict();
        if (!dict) {
            panelState.activeKey = null;
            return;
        }
        const inner = span.firstChild;
        const runText = span.textContent ?? "";
        let pos = 0;
        if (inner) pos = offsetAtPoint(inner, e.clientX, e.clientY);
        // Clamp onto a Chinese char.
        if (pos >= runText.length || !isChineseChar(runText.charCodeAt(pos))) {
            pos = 0;
        }
        const seg = segmentAtPos(dict, runText, pos);
        if (!seg) {
            panelState.activeKey = null;
            destroyPopup();
            return;
        }

        // Same word still under cursor → nothing to redo (no flicker).
        const key = `${seg.start}:${seg.end}:${seg.word}`;
        if (key === panelState.activeKey) return;
        panelState.activeKey = key;

        // Popup first (it tears down any previous popup + highlight)...
        showPopupAt(seg.entries, e.clientX, e.clientY, provider.getOptions());

        // ...then highlight just the matched characters via a Range over the run.
        if (inner) {
            try {
                const range = document.createRange();
                range.setStart(inner, seg.start);
                range.setEnd(inner, Math.min(seg.end, runText.length));
                showHighlight(range.getClientRects());
            } catch {
                /* ignore range errors */
            }
        }
    };

    // mouseenter shows; re-segment on move so the word tracks the cursor.
    span.addEventListener("mouseenter", show);
    span.addEventListener("mousemove", show);
    span.addEventListener("mouseleave", (e) => {
        // Don't close if the cursor moved onto the popup itself.
        const to = e.relatedTarget as HTMLElement | null;
        if (to && to.closest(".zhongwen-popup")) return;
        panelState.activeKey = null;
        destroyPopup();
    });
}
