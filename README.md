# BetterMediaPicker (Kettu prototype v0.1.1)

## v0.1.1: Photos tray diagnostics

The built-in **+ → Photos** tray is **not modified** by this version. Version 0.1.0 failed to locate `getPhotos` on the reported Discord 351.11 build. This proves that lookup failed, not that native photo access is impossible.

This update adds **Scan loaded modules** and **Copy diagnostic report** to plugin settings. To investigate the tray:

1. Update the plugin and reload Kettu. Confirm **0.1.1** in this plugin's settings.
2. Open a chat, tap **+**, and open the **Photos** tray once.
3. Return to this plugin's settings and tap **Scan loaded modules**.
4. Tap **Copy diagnostic report** and paste into the ChatGPT conversation where this plugin is being developed.

The scan reads metadata from already initialized Metro modules and lists relevant native module identifiers. It does not force-load modules, call photo APIs, evaluate export getters, read photo contents, or include property values such as filenames, file paths, message text or credentials. Nothing is uploaded automatically. Reports are kept in memory until plugin unload; the copy button writes the report to the clipboard. Names may be stripped from production code, so a report may still be insufficient to locate the tray.

The older Files gallery below remains experimental. Its column/sorting settings apply only to that custom gallery if the required interfaces are detected, and do not affect the built-in Photos tray.

A **real, experimental classic Vendetta-family plugin**. Targets Kettu's Discord Android **Attach File** action. It aims to open a photo grid *inside Discord* with persistent settings: 3, 4, 5, or 6 columns; sorting among loaded photos; and instant single-tap attachment or multi-selection.

**Status:** Source and loader smoke tests passed, **not tested on a physical device**. Discord's internal media modules change frequently. This is NOT a confirmed working replacement for the stock thumbnail tray on any specific Discord/Kettu build.

## What it changes

- Intercepts the Discord `handleAttachFile` action. This hook was verified from fres's AltMediaPicker Vendetta plugin source.
- If the Discord build exposes a CameraRoll-compatible `getPhotos` module and Vendetta's custom-alert interface, it opens a grid without switching apps.
- The grid supports **3–6 columns**, **newest/oldest/filename sort**, paging in groups of up to 120, an optional **single-tap attach**, and a **System picker** fallback button.
- Uses Discord's `handleSelectKeyboardItem` to add selected photos to the current composer (up to 10 per batch). It does **not** directly send Discord messages.
- The plugin stores only its own settings in Vendetta's local plugin storage. No network access, telemetry, tokens, or photo uploads are implemented.

### Known limitations

- Sorting applies **only to the photos loaded so far**, not all photos in your library. Selecting "oldest" does *not* fetch the absolute oldest photos automatically.
- The native CameraRoll module may not be exposed on your build. In that case **the plugin intentionally doesn't install a hook** and stock Discord behaves as before.
- Photos only; no video, folders, search, camera capture, or album filtering yet.
- It modifies the Attach File action, not necessarily the inline thumbnail strip shown immediately upon tapping +. The exact behavior depends on your client build.
- Settings change immediately, but toggling the plugin's *enabled* flag while already loaded only changes interception behavior, not whether the hook is installed.
- The custom alert may behave differently on newer Kettu/Discord versions. On-device testing is required.
- No APK or root is required. However, unofficial Discord modifications may violate Discord's terms and can create account risks. Test with care.

## Install on Kettu via GitHub Pages

This ZIP is **not** an Android APK and the raw ZIP is **not** a direct install link for Kettu.

1. Make a GitHub repository (for example `better-media-picker`).
2. Extract this ZIP and **upload the contents of the `docs` directory into a `docs` folder at your repository root**. You should have `docs/BetterMediaPicker/index.js` and `docs/BetterMediaPicker/manifest.json` in GitHub.
3. Repository **Settings → Pages → Deploy from a branch**. Choose branch `main`, directory `/docs`, Save.
4. Confirm the URL `https://YOURNAME.github.io/better-media-picker/BetterMediaPicker/manifest.json` opens as JSON in your browser.
5. In **Kettu → Settings → Plugins → +**, paste **the folder URL without `manifest.json`**:

   `https://YOURNAME.github.io/better-media-picker/BetterMediaPicker/`

6. Enable the plugin, reload Discord, then open plugin settings for diagnostics. Try **+ → Attach File** in a DM where you can safely test.
7. If CameraRoll is missing or the gallery does not open, disable/uninstall the plugin. The plugin should leave the normal picker alone when the needed APIs are missing.

### Local Android hosting (optional)

If you already have Termux, copy the `docs` folder to Termux and run `python -m http.server 8765 --directory docs`. While the server stays running on your phone, install `http://127.0.0.1:8765/BetterMediaPicker/` in Kettu. Whether local HTTP links are allowed depends on Kettu's loader. This is for development, not everyday use.

## Testing checklist

1. Open Kettu's plugin settings. Check **Status**, **Media bridge**, **Discord attach hook**, **Sheet UI**. No account token or chat logs are needed.
2. Tap + → Attach File. Confirm whether the custom gallery opens. If the original remains, the target UI may be a different component or the media API was absent.
3. Tap the `4 columns` button; it should cycle 4 → 5 → 6 → 3. Tap `Sort: newest`; it should cycle newest → oldest → filename.
4. Tap one image with instant attach enabled. It should appear in the composer; **review it before sending**.
5. Turn off instant attach in plugin settings, reload the picker, select two images, and tap `Attach 2`.
6. Turn the plugin off or disable in settings, then confirm Discord's original flow returns.

**If testing fails:** Record the Kettu version, Discord version and the four diagnostic statuses (not your token). A screenshot of the non-sensitive picker UI helps target the next patch.

## Architecture

This is a deliberately dependency-free, prebuilt JavaScript expression for *classic* Vendetta-compatible clients (including Kettu builds that retain the classic plugin loader). The entrypoint gets a `vendetta` object provided by the loader. Vendetta-style plugin code is evaluated as an expression returning `{onLoad,onUnload,settings}`.

Source = `index.js`; deployable files = `docs/BetterMediaPicker/index.js` and `manifest.json`. Both JavaScript files are identical. This package does not target Revenge Next's newer ZIP/plugin repository format.

## Source references

- Vendetta plugin template: https://github.com/vendetta-mod/plugin-template
- fres's AltMediaPicker source: https://github.com/fres621/vendetta-plugins/blob/master/plugins/AltMediaPicker/src/patch.ts
- Kettu source: https://github.com/C0C0B01/Kettu

## Run the local tests

From the extracted directory with Node.js installed:

`node tests/smoke.mjs`

Tests validate the plugin expression and safe fallback **against mocks**, not against a running Discord app.
