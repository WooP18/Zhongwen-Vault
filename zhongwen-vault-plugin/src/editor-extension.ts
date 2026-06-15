/*
 CodeMirror 6 integration for the Obsidian editor (Live Preview / Source):
  1. hoverTooltip — shows the dictionary popup after the hover delay.
  2. A mousemove-driven decoration — highlights the word under the cursor
     instantly (independent of the tooltip delay), themed via CSS variables.

 CM6 owns the tooltip DOM; we track the active entry so the global "S"
 shortcut can save it.
*/

import {
    hoverTooltip,
    EditorView,
    Tooltip,
    Decoration,
    DecorationSet,
    ViewPlugin,
} from "@codemirror/view";
import { StateField, StateEffect, Extension } from "@codemirror/state";
import { ZhongwenDictionary } from "./dictionary";
import { segmentAtPos } from "./segmenter";
import { renderPopupDom, setCurrentEntry, PopupOptions } from "./popup";

/** Provider gives the extension live access to the loaded dict + settings. */
export interface ZhongwenProvider {
    getDict(): ZhongwenDictionary | null;
    getOptions(): PopupOptions;
    getHoverDelay(): number;
}

// --- highlight decoration --------------------------------------------------

const setHighlight = StateEffect.define<{ from: number; to: number } | null>();

const highlightMark = Decoration.mark({ class: "zhongwen-editor-highlight" });

const highlightField = StateField.define<DecorationSet>({
    create() {
        return Decoration.none;
    },
    update(deco, tr) {
        deco = deco.map(tr.changes);
        for (const e of tr.effects) {
            if (e.is(setHighlight)) {
                deco = e.value
                    ? Decoration.set([highlightMark.range(e.value.from, e.value.to)])
                    : Decoration.none;
            }
        }
        return deco;
    },
    provide: (f) => EditorView.decorations.from(f),
});

/** ViewPlugin: on mousemove, segment under cursor and set the highlight. */
function highlightPlugin(provider: ZhongwenProvider) {
    return ViewPlugin.fromClass(
        class {
            current: string | null = null;
            view: EditorView;
            onMove: (e: MouseEvent) => void;
            onLeave: () => void;

            constructor(view: EditorView) {
                this.view = view;
                this.onMove = (e: MouseEvent) => this.handleMove(e);
                this.onLeave = () => this.clear();
                view.dom.addEventListener("mousemove", this.onMove);
                view.dom.addEventListener("mouseleave", this.onLeave);
            }

            handleMove(e: MouseEvent) {
                const dict = provider.getDict();
                if (!dict) return this.clear();

                const pos = this.view.posAtCoords({ x: e.clientX, y: e.clientY });
                if (pos == null) return this.clear();

                // Quick char-code check before paying for full doc serialization.
                const charCode = this.view.state.doc.sliceString(pos, pos + 1).charCodeAt(0);
                if (isNaN(charCode) || charCode < 0x3400) return this.clear();

                const doc = this.view.state.doc.toString();
                const seg = segmentAtPos(dict, doc, pos);
                if (!seg) return this.clear();

                const key = `${seg.start}:${seg.end}`;
                if (key === this.current) return; // same word, no churn
                this.current = key;
                this.view.dispatch({ effects: setHighlight.of({ from: seg.start, to: seg.end }) });
            }

            clear() {
                if (this.current === null) return;
                this.current = null;
                this.view.dispatch({ effects: setHighlight.of(null) });
            }

            destroy() {
                this.view.dom.removeEventListener("mousemove", this.onMove);
                this.view.dom.removeEventListener("mouseleave", this.onLeave);
            }
        }
    );
}

// --- hover tooltip ---------------------------------------------------------

function hoverExtension(provider: ZhongwenProvider) {
    return hoverTooltip(
        (view: EditorView, pos: number): Tooltip | null => {
            const dict = provider.getDict();
            if (!dict) return null;

            // Cheap check before full serialization.
            const charCode = view.state.doc.sliceString(pos, pos + 1).charCodeAt(0);
            if (isNaN(charCode) || charCode < 0x3400) return null;

            const doc = view.state.doc.toString();
            const seg = segmentAtPos(dict, doc, pos);
            if (!seg) return null;

            return {
                pos: seg.start,
                end: seg.end,
                above: false,
                create() {
                    setCurrentEntry(seg.entries[0]);
                    const dom = renderPopupDom(seg.entries, provider.getOptions());
                    return {
                        dom,
                        destroy() {
                            setCurrentEntry(null);
                        },
                    };
                },
            };
        },
        { hoverTime: provider.getHoverDelay() }
    );
}

/** Full editor extension: highlight (instant) + tooltip (delayed). */
export function zhongwenEditorExtension(provider: ZhongwenProvider): Extension {
    return [highlightField, highlightPlugin(provider), hoverExtension(provider)];
}
