/*
 CodeMirror 6 hover tooltip for the Obsidian editor (Live Preview / Source).
 CM6 owns the tooltip DOM + positioning; we just supply the card and track
 the active entry so the global "S" shortcut can save it.
*/

import { hoverTooltip, EditorView, Tooltip } from "@codemirror/view";
import { ZhongwenDictionary } from "./dictionary";
import { segmentAtPos } from "./segmenter";
import { renderPopupDom, setCurrentEntry, PopupOptions } from "./popup";

/** Provider gives the extension live access to the loaded dict + settings. */
export interface ZhongwenProvider {
    getDict(): ZhongwenDictionary | null;
    getOptions(): PopupOptions;
    getHoverDelay(): number;
}

/**
 * Build the CM6 hover-tooltip extension. Returns null-tooltip when no Chinese
 * word or dict match sits under the cursor.
 */
export function zhongwenEditorExtension(provider: ZhongwenProvider) {
    return hoverTooltip(
        (view: EditorView, pos: number): Tooltip | null => {
            const dict = provider.getDict();
            if (!dict) return null;

            const doc = view.state.doc.toString();
            const seg = segmentAtPos(dict, doc, pos);
            if (!seg) return null;

            return {
                pos: seg.start,
                end: seg.end,
                above: false,
                create() {
                    setCurrentEntry(seg.entry);
                    const dom = renderPopupDom(seg.entry, provider.getOptions());
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
