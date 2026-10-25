/*
 PinyinPop — plugin entry point.
*/

import {
    App,
    Notice,
    Plugin,
    PluginSettingTab,
    Setting,
    TFile,
    normalizePath,
} from "obsidian";
import dictText from "./data/cedict_ts.u8";
import idxText from "./data/cedict.idx";
import { Extension } from "@codemirror/state";

import { ZhongwenDictionary, DictEntry } from "./src/dictionary";
import { toPinyinText } from "./src/pinyin";
import { zhongwenEditorExtension, ZhongwenProvider } from "./src/editor-extension";
import { makeReadingProcessor } from "./src/reading-view";
import {
    PopupOptions,
    getCurrentEntry,
    destroyPopup,
    showSaveFeedback,
} from "./src/popup";

interface ZhongwenVaultSettings {
    wordListNote: string;
    showHSKLevel: boolean;
    showTraditional: boolean;
    hoverDelayMs: number;
    enableInEditor: boolean;
    enableInReadingView: boolean;
}

const DEFAULT_SETTINGS: ZhongwenVaultSettings = {
    wordListNote: "Chinese/Word List",
    showHSKLevel: true,
    showTraditional: false,
    hoverDelayMs: 300,
    enableInEditor: true,
    enableInReadingView: true,
};

export default class ZhongwenVaultPlugin extends Plugin {
    settings!: ZhongwenVaultSettings;
    private dict: ZhongwenDictionary | null = null;
    // Mutable array handed to registerEditorExtension; we swap its contents and
    // call workspace.updateOptions() to apply settings changes without reload.
    private editorExtensions: Extension[] = [];

    async onload() {
        await this.loadSettings();

        this.loadDictionary();

        const provider: ZhongwenProvider = {
            getDict: () => (this.settings.enableInEditor ? this.dict : null),
            getOptions: () => this.popupOptions(),
            getHoverDelay: () => this.settings.hoverDelayMs,
        };

        // Editor (CM6) hover.
        this.editorExtensions.push(zhongwenEditorExtension(provider));
        this.registerEditorExtension(this.editorExtensions);

        // Reading view hover.
        this.registerMarkdownPostProcessor(
            makeReadingProcessor({
                getDict: () =>
                    this.settings.enableInReadingView ? this.dict : null,
                getOptions: () => this.popupOptions(),
            })
        );

        // "S" saves the word in the visible popup, in the main window and in
        // every popout window.
        this.registerDomEvent(document, "keydown", (e) => this.onKeyDown(e), true);
        this.registerEvent(
            this.app.workspace.on("window-open", (_win, win) => {
                this.registerDomEvent(win.document, "keydown", (e) => this.onKeyDown(e), true);
            })
        );

        // Same action as a command, so it can be bound to any hotkey.
        this.addCommand({
            id: "save-popup-word",
            name: "Save word from popup",
            checkCallback: (checking) => {
                const entry = this.visiblePopupEntry();
                if (!entry) return false;
                if (!checking) void this.saveWord(entry);
                return true;
            },
        });

        this.addSettingTab(new ZhongwenVaultSettingTab(this.app, this));
    }

    onunload() {
        destroyPopup();
    }

    private popupOptions(): PopupOptions {
        return {
            showHSKLevel: this.settings.showHSKLevel,
            showTraditional: this.settings.showTraditional,
        };
    }

    private loadDictionary() {
        // dictText keeps its CRLF line endings (see esbuild.config.mjs): the
        // cedict.idx offsets were computed against the original CRLF text, so
        // any line-ending normalization would shift them and break lookups.
        this.dict = new ZhongwenDictionary(dictText, idxText);
    }

    /** Entry of the popup currently on screen, or null if none is shown. */
    private visiblePopupEntry(): DictEntry | null {
        const entry = getCurrentEntry();
        if (!entry || !activeDocument.querySelector(".zhongwen-popup")) return null;
        return entry;
    }

    private onKeyDown(e: KeyboardEvent) {
        if (e.key !== "s" && e.key !== "S") return;
        // Don't steal modified shortcuts (Ctrl/Cmd+S = save file).
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        // Never swallow "s" typed into a text field (search, rename, settings).
        // The editor needs no check: its popup closes on any edit, so a visible
        // editor popup means the user is hovering, not typing.
        const target = e.target as HTMLElement | null;
        if (target?.closest?.("input, textarea")) return;
        const entry = this.visiblePopupEntry();
        if (!entry) return;

        e.preventDefault();
        e.stopPropagation();
        void this.saveWord(entry);
    }

    private async saveWord(entry: DictEntry) {
        const path = normalizePath(this.settings.wordListNote + ".md");
        // Skip CL: (classifier) entries; use first real definition sense.
        const realDef = entry.definitions.find((d) => !d.startsWith("CL:")) ?? "";
        // Convert numeric pinyin to tone marks for readability.
        const py = toPinyinText(entry.pinyin);
        const headword = `- **${entry.simplified}** (${py})`;
        const line = `${headword} — ${realDef}`;

        try {
            const existing = this.app.vault.getAbstractFileByPath(path);
            if (existing instanceof TFile) {
                let added = false;
                // vault.process is an atomic read-modify-write: edits made to
                // the note in between are never overwritten.
                await this.app.vault.process(existing, (content) => {
                    // Same word and reading already listed: leave the note as is.
                    if (content.split("\n").some((l) => l.startsWith(headword + " "))) {
                        return content;
                    }
                    added = true;
                    const sep = content === "" || content.endsWith("\n") ? "" : "\n";
                    return content + sep + line + "\n";
                });
                if (!added) {
                    showSaveFeedback("Already saved");
                    return;
                }
            } else {
                // Ensure parent folders exist.
                const folder = path.contains("/")
                    ? path.slice(0, path.lastIndexOf("/"))
                    : "";
                if (folder && !this.app.vault.getAbstractFileByPath(folder)) {
                    await this.app.vault.createFolder(folder).catch(() => {});
                }
                await this.app.vault.create(
                    path,
                    `# Chinese Word List\n\n${line}\n`
                );
            }
            showSaveFeedback();
        } catch (err) {
            console.error("PinyinPop: save failed", err);
            new Notice("PinyinPop: failed to save word (see console)");
        }
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<ZhongwenVaultSettings>);
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    /** Rebuild the CM6 hover extension (e.g. after hover-delay change). */
    refreshEditorExtension() {
        const provider: ZhongwenProvider = {
            getDict: () => (this.settings.enableInEditor ? this.dict : null),
            getOptions: () => this.popupOptions(),
            getHoverDelay: () => this.settings.hoverDelayMs,
        };
        this.editorExtensions.length = 0;
        this.editorExtensions.push(zhongwenEditorExtension(provider));
        this.app.workspace.updateOptions();
    }
}

class ZhongwenVaultSettingTab extends PluginSettingTab {
    plugin: ZhongwenVaultPlugin;

    constructor(app: App, plugin: ZhongwenVaultPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        new Setting(containerEl)
            .setName("Word list note path")
            .setDesc('Note where saved words are appended (no ".md"). Folders are created if missing.')
            .addText((text) =>
                text
                    .setPlaceholder("Chinese/Word List")
                    .setValue(this.plugin.settings.wordListNote)
                    .onChange(async (value) => {
                        this.plugin.settings.wordListNote =
                            value.trim() || DEFAULT_SETTINGS.wordListNote;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Show character count")
            .setDesc("Show the number of characters under the definitions.")
            .addToggle((t) =>
                t
                    .setValue(this.plugin.settings.showHSKLevel)
                    .onChange(async (v) => {
                        this.plugin.settings.showHSKLevel = v;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Show traditional character")
            .setDesc("Show the traditional form next to the simplified form when they differ.")
            .addToggle((t) =>
                t
                    .setValue(this.plugin.settings.showTraditional)
                    .onChange(async (v) => {
                        this.plugin.settings.showTraditional = v;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Hover delay (ms)")
            .setDesc("How long to hover before the popup appears (editor view).")
            .addSlider((s) =>
                s
                    .setLimits(100, 800, 50)
                    .setValue(this.plugin.settings.hoverDelayMs)
                    .onChange(async (v) => {
                        this.plugin.settings.hoverDelayMs = v;
                        await this.plugin.saveSettings();
                        this.plugin.refreshEditorExtension();
                    })
            );

        new Setting(containerEl)
            .setName("Enable in editor")
            .setDesc("Show the popup while editing (Live Preview / Source mode).")
            .addToggle((t) =>
                t
                    .setValue(this.plugin.settings.enableInEditor)
                    .onChange(async (v) => {
                        this.plugin.settings.enableInEditor = v;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Enable in reading view")
            .setDesc("Show the popup in rendered (reading) view.")
            .addToggle((t) =>
                t
                    .setValue(this.plugin.settings.enableInReadingView)
                    .onChange(async (v) => {
                        this.plugin.settings.enableInReadingView = v;
                        await this.plugin.saveSettings();
                    })
            );
    }
}
