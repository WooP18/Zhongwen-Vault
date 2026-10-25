/*
 Unpacks the CC-CEDICT data embedded by the "cedict" esbuild plugin
 (esbuild.config.mjs) and builds the dictionary from it.

 The packed form is base64 of raw-deflated text holding four columns
 (traditional or "", simplified, pinyin, definitions), entries separated by
 "\n" and columns by "\0". This rebuilds the exact CC-CEDICT lines
 (`Trad Simp [pin1 yin1] /def1/def2/`) plus the lookup index that Zhongwen
 ships as cedict.idx, so ZhongwenDictionary works unchanged.

 No Obsidian APIs: can be unit-tested in Node.
*/

import { inflateSync, strFromU8 } from "fflate";
import { ZhongwenDictionary } from "./dictionary";

export function unpackCedict(packed: string): ZhongwenDictionary {
    const bin = atob(packed);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

    const [trad, simp, pinyin, defs] = strFromU8(inflateSync(bytes))
        .split("\0")
        .map((col) => col.split("\n"));

    // Rebuild the dictionary text and, for each headword (traditional and
    // simplified), the offsets of the lines it appears on.
    const lines: string[] = [];
    const offsets = new Map<string, number[]>();
    const addOffset = (key: string, offset: number) => {
        const list = offsets.get(key);
        if (list) list.push(offset);
        else offsets.set(key, [offset]);
    };
    let offset = 0;
    for (let i = 0; i < simp.length; i++) {
        const s = simp[i];
        const t = trad[i] || s;
        const line = `${t} ${s} [${pinyin[i]}] /${defs[i]}/`;
        lines.push(line);
        addOffset(t, offset);
        if (s !== t) addOffset(s, offset);
        offset += line.length + 1; // + "\n"
    }

    // Index lines `key,offset1,offset2`, sorted with the same string
    // comparison ZhongwenDictionary's binary search uses. Trailing "\n" so the
    // last line is terminated like every other.
    const index = Array.from(offsets, ([key, list]) => `${key},${list.join(",")}`)
        .sort()
        .join("\n") + "\n";

    return new ZhongwenDictionary(lines.join("\n"), index);
}
