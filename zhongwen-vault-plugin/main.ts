/*
 Zhongwen Vault — plugin entry point.

 Loads the bundled CC-CEDICT data from the plugin folder at runtime (keeping
 main.js small), wires up the editor (CM6) + reading-view integrations, the
 save-to-vault shortcut, and the settings tab.
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

        // Load dictionary asynchronously; hovers no-op until ready.
        this.loadDictionary().catch((e) => {
            console.error("Zhongwen Vault: failed to load dictionary", e);
            new Notice("Zhongwen Vault: failed to load dictionary (see console)");
        });

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

        // Global "S" to save the word in the currently visible popup.
        this.registerDomEvent(document, "keydown", (e) => this.onKeyDown(e), true);

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

    /** Read cedict_ts.u8 + cedict.idx from the plugin's own folder. */
    private async loadDictionary() {
        const dir = this.manifest.dir;
        if (!dir) throw new Error("plugin dir unknown");
        const adapter = this.app.vault.adapter;
        const dictText = await adapter.read(
            normalizePath(`${dir}/data/cedict_ts.u8`)
        );
        const idxText = await adapter.read(
            normalizePath(`${dir}/data/cedict.idx`)
        );
        this.dict = new ZhongwenDictionary(dictText, idxText);
    }

    private onKeyDown(e: KeyboardEvent) {
        if (e.key !== "s" && e.key !== "S") return;
        // Only act when a popup is actually on screen.
        const popupVisible = !!document.querySelector(".zhongwen-popup");
        const entry = getCurrentEntry();
        if (!popupVisible || !entry) return;
        // Don't steal modified shortcuts (Ctrl/Cmd+S = save file).
        if (e.ctrlKey || e.metaKey || e.altKey) return;

        e.preventDefault();
        e.stopPropagation();
        this.saveWord(entry);
    }

    private async saveWord(entry: DictEntry) {
        const path = normalizePath(this.settings.wordListNote + ".md");
        // Skip CL: (classifier) entries; use first real definition sense.
        const realDef = entry.definitions.find((d) => !d.startsWith("CL:")) ?? "";
        // Convert numeric pinyin to tone marks for readability.
        const py = toPinyinText(entry.pinyin);
        const line = `- **${entry.simplified}** (${py}) — ${realDef}`;

        try {
            const existing = this.app.vault.getAbstractFileByPath(path);
            if (existing instanceof TFile) {
                const content = await this.app.vault.read(existing);
                const sep = content.endsWith("\n") ? "" : "\n";
                await this.app.vault.modify(existing, content + sep + line + "\n");
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
            console.error("Zhongwen Vault: save failed", err);
            new Notice("Zhongwen Vault: failed to save word (see console)");
        }
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
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
            .setName("Show meta row")
            .setDesc("Show character count under definitions. (HSK dataset is not bundled — see README.)")
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
                    .setDynamicTooltip()
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
