# Changelog

## 1.0.6

- **Renamed to PinyinPop.** Only the display name changes; the plugin id stays
  `zhongwen-vault`, so existing installs, settings and the word list keep working.
- The CC-CEDICT data is now embedded in `main.js` as plain text instead of a
  base64 blob with a runtime decoder. Same dictionary, byte-for-byte; the bundle
  is smaller and readable, which clears false positives from automated plugin
  scans (base64 decoding, "inline WASM", filesystem/eval/clipboard access).

## 1.0.5

- **Fix: hover showed no translation for any character (editor and reading view).**
  The bundled CC-CEDICT data lost its CRLF line endings — first to esbuild's
  text loader, then to git's line-ending normalization on CI checkout. Because
  `cedict.idx` stores offsets into the original CRLF text, every lookup landed
  on the wrong line and returned nothing (reading view showed only the "?" help
  cursor). The data is now loaded as raw bytes and stored byte-exact in git, so
  offsets stay valid in released builds.

## 1.0.4

- Attempted fix: load the dictionary as bytes and decode at runtime (incomplete
  — see 1.0.5 for the git-side cause).

## 1.0.3

- Fix popup positioning in popped-out windows; trigger on `○` in the editor.
