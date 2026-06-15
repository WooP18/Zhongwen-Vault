/*
 Dictionary lookup ported from Zhongwen (dict.js).
 Zhongwen - A Chinese-English Pop-Up Dictionary
 Copyright (C) 2019 Christian Schiller — GPL-2.0
 Originally based on Rikaikun / Rikaichan / RikaiXUL.

 Pure logic: no browser, Chrome, or Obsidian APIs. The raw CC-CEDICT text
 (cedict_ts.u8) and its index (cedict.idx) are passed in as strings, so this
 module can be unit-tested in isolation.
*/

/** A single parsed CC-CEDICT sense for one headword. */
export interface DictEntry {
    /** Traditional form. */
    traditional: string;
    /** Simplified form. */
    simplified: string;
    /** Raw numeric pinyin, e.g. "ni3 hao3". */
    pinyin: string;
    /** Definition senses split on '/'. */
    definitions: string[];
    /** The exact substring of the query this entry matched. */
    match: string;
}

/** Result of a wordSearch: the matched entries plus how many chars matched. */
export interface SearchResult {
    entries: DictEntry[];
    /** Length (in chars) of the longest matched word. */
    matchLen: number;
    /** True if more results existed than maxTrim and were dropped. */
    more: boolean;
}

/**
 * Faithful port of Zhongwen's ZhongwenDictionary.
 *
 * Index format (cedict.idx): sorted lines `<key>,<offset1>,<offset2>,...`
 * where each offset points at the start of a line in the dict text.
 * Dict format (cedict_ts.u8): `Trad Simp [pin1 yin1] /def1/def2/`.
 */
export class ZhongwenDictionary {
    private wordDict: string;
    private wordIndex: string;
    private cache: Record<string, string[]>;

    constructor(wordDict: string, wordIndex: string) {
        this.wordDict = wordDict;
        this.wordIndex = wordIndex;
        this.cache = {};
    }

    /** Binary search for `needle` over newline-delimited sorted `haystack`. */
    private static find(needle: string, haystack: string): string | null {
        let beg = 0;
        let end = haystack.length - 1;

        while (beg < end) {
            const mi = Math.floor((beg + end) / 2);
            const i = haystack.lastIndexOf("\n", mi) + 1;

            const mis = haystack.substr(i, needle.length);
            if (needle < mis) {
                end = i - 1;
            } else if (needle > mis) {
                beg = haystack.indexOf("\n", mi + 1) + 1;
            } else {
                return haystack.substring(i, haystack.indexOf("\n", mi + 1));
            }
        }

        return null;
    }

    /** Parse a raw dict line into a DictEntry, or null if malformed. */
    private static parseLine(line: string, match: string): DictEntry | null {
        const m = line.match(/^([^\s]+?)\s+([^\s]+?)\s+\[(.*?)\]?\s*\/(.+)\//);
        if (!m) return null;
        return {
            traditional: m[1],
            simplified: m[2],
            pinyin: m[3],
            definitions: m[4].split("/").map((d) => d.trim()).filter(Boolean),
            match,
        };
    }

    /**
     * Greedy longest-match search starting at the head of `word`.
     * Tries the full string, then trims one char at a time off the end,
     * exactly like the original extension. Returns the matched entries
     * (longest-match entries first) and the matched length.
     */
    wordSearch(word: string, max?: number): SearchResult | null {
        const dict = this.wordDict;
        const index = this.wordIndex;
        const maxTrim = max || 7;

        const entries: DictEntry[] = [];
        let count = 0;
        let maxLen = 0;
        let more = false;

        outer: while (word.length > 0) {
            let ix = this.cache[word];
            if (!ix) {
                const found = ZhongwenDictionary.find(word + ",", index);
                if (!found) {
                    this.cache[word] = [];
                    word = word.substr(0, word.length - 1);
                    continue;
                }
                ix = found.split(",");
                this.cache[word] = ix;
            }

            for (let j = 1; j < ix.length; ++j) {
                const offset = parseInt(ix[j], 10);
                const nl = dict.indexOf("\n", offset);
                const line = dict.substring(offset, nl === -1 ? undefined : nl);

                if (count >= maxTrim) {
                    more = true;
                    break outer;
                }
                ++count;
                if (maxLen === 0) {
                    maxLen = word.length;
                }

                const entry = ZhongwenDictionary.parseLine(line, word);
                if (entry) entries.push(entry);
            }

            word = word.substr(0, word.length - 1);
        }

        if (entries.length === 0) return null;
        return { entries, matchLen: maxLen, more };
    }
}

