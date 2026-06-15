/*
 Chinese word segmentation, ported from Zhongwen's lookup behavior.

 Zhongwen does not pre-tokenize text: it grabs a window of characters
 starting at the cursor and lets the dictionary's greedy longest-match
 (wordSearch) decide where the word ends. We mirror that: extract a CJK
 window at the cursor, hand it to the dictionary, use the returned matchLen.

 Pure logic: no DOM / Obsidian APIs.
*/

import { ZhongwenDictionary, DictEntry } from "./dictionary";

/** Max characters Zhongwen ever considers for a single word. */
const MAX_WORD_LEN = 7;

/**
 * True if `cp` (a code point) is a CJK character Zhongwen treats as text.
 * Mirrors the ranges in content.js triggerSearch().
 */
export function isChineseChar(cp: number): boolean {
    return (
        cp === 0x25cb || // ○
        (0x3400 <= cp && cp <= 0x9fff) || // CJK + Ext A
        (0xf900 <= cp && cp <= 0xfaff) || // CJK Compatibility Ideographs
        (0xff21 <= cp && cp <= 0xff3a) || // fullwidth A-Z
        (0xff41 <= cp && cp <= 0xff5a) || // fullwidth a-z
        (0xd800 <= cp && cp <= 0xdfff) // surrogates (Ext B+)
    );
}

/**
 * Grab the run of Chinese characters starting at `pos` in `text`, capped at
 * MAX_WORD_LEN. If `pos` is not on a Chinese char, returns "".
 */
export function chineseWindowAt(text: string, pos: number): string {
    if (pos < 0 || pos >= text.length) return "";
    if (!isChineseChar(text.charCodeAt(pos))) return "";

    let end = pos;
    while (
        end < text.length &&
        end - pos < MAX_WORD_LEN &&
        isChineseChar(text.charCodeAt(end))
    ) {
        end++;
    }
    return text.slice(pos, end);
}

/** Result of segmenting at a position. */
export interface Segment {
    word: string;
    entry: DictEntry;
    /** Start index in the source text. */
    start: number;
    /** End index (exclusive) in the source text. */
    end: number;
}

/**
 * Segment the word at `pos`: take the CJK window, run greedy longest-match
 * against the dictionary, return the matched word + best entry + span.
 * Returns null if nothing Chinese is under `pos` or no dict match exists.
 */
export function segmentAtPos(
    dict: ZhongwenDictionary,
    text: string,
    pos: number
): Segment | null {
    const window = chineseWindowAt(text, pos);
    if (!window) return null;

    const result = dict.wordSearch(window);
    if (!result || result.entries.length === 0) return null;

    const matchLen = result.matchLen || 1;
    return {
        word: window.slice(0, matchLen),
        entry: result.entries[0],
        start: pos,
        end: pos + matchLen,
    };
}
