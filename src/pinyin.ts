/*
 Pinyin tone-mark conversion + tone-color mapping, ported from Zhongwen
 (content.js: tones/utones/parse/tonify/pinyinAndZhuyin).

 Pure logic: no DOM / Obsidian APIs. Produces plain strings; the popup layer
 decides how to wrap them in DOM with the right CSS classes.
*/

/** Combining tone diacritics, indexed by tone number (5 = neutral). */
const COMBINING: Record<number, string> = {
    1: "̄", // macron
    2: "́", // acute
    3: "̌", // caron
    4: "̀", // grave
    5: "",
};

/**
 * Tone -> CSS custom property + fallback color. The popup uses the var()
 * with the hardcoded value only as a fallback, so themes can override.
 * (Spec-mandated mapping; tone 5 uses --text-muted.)
 */
export const TONE_COLOR_VARS: Record<number, string> = {
    1: "var(--color-red, #d93025)",
    2: "var(--color-orange, #e8711a)",
    3: "var(--color-green, #1a7f37)",
    4: "var(--color-blue, #1a56db)",
    5: "var(--text-muted)",
};

/** Split a numeric-pinyin syllable into [pre, vowels, post, tone]. */
function parseSyllable(s: string): RegExpMatchArray | null {
    return s.match(/([^AEIOU:aeiou]*)([AEIOUaeiou:]+)([^aeiou:]*)([1-5])/);
}

/**
 * Place the tone mark on the correct vowel of `vowels` and return the
 * accented text. Rules ported verbatim: 'ou' -> mark on o; otherwise a/e
 * win, else the last vowel; "u:" becomes ü.
 */
function tonify(vowels: string, tone: number): string {
    if (vowels === "ou") {
        return "o" + COMBINING[tone] + "u";
    }
    let text = "";
    let tonified = false;
    for (let i = 0; i < vowels.length; i++) {
        const c = vowels.charAt(i);
        text += c;
        if (c === "a" || c === "e") {
            text += COMBINING[tone];
            tonified = true;
        } else if (i === vowels.length - 1 && !tonified) {
            text += COMBINING[tone];
            tonified = true;
        }
    }
    return text.replace(/u:/, "ü");
}

/** One rendered syllable: its accented text and tone number. */
export interface PinyinSyllable {
    text: string;
    tone: number;
}

/**
 * Convert a raw numeric-pinyin string (e.g. "ni3 hao3", "nu:3", "hua1r5")
 * into a list of accented syllables with tone numbers. Mirrors
 * pinyinAndZhuyin() but returns structured data instead of HTML.
 */
export function toPinyinSyllables(syllables: string): PinyinSyllable[] {
    const out: PinyinSyllable[] = [];
    // Split on whitespace/middle-dot AND after each tone digit, so jammed
    // refs like "qi1yan2" (common inside embedded cross-references) tokenize.
    const parts = syllables
        .replace(/([1-5])(?=[a-zA-Zü:])/g, "$1 ")
        .split(/[\s·]+/);

    for (const syllable of parts) {
        if (!syllable) continue;
        if (syllable === ",") {
            out.push({ text: ",", tone: 5 });
            continue;
        }
        if (syllable === "r5") {
            out.push({ text: "r", tone: 5 });
            continue;
        }
        if (syllable === "xx5") {
            out.push({ text: "?", tone: 5 });
            continue;
        }
        const m = parseSyllable(syllable);
        if (!m) {
            // Non-tonal token (rare); pass through as neutral.
            out.push({ text: syllable, tone: 5 });
            continue;
        }
        const tone = parseInt(m[4], 10);
        out.push({ text: m[1] + tonify(m[2], tone) + m[3], tone });
    }
    return out;
}

/** Flatten syllables to a plain accented string, space-separated. */
export function toPinyinText(syllables: string): string {
    return toPinyinSyllables(syllables)
        .map((s) => s.text)
        .join(" ")
        .replace(/\s+,/g, " ,");
}
