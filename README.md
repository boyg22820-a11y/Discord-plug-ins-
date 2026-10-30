# BetterMediaPicker · Quick Photos 0.2.0

A custom photo collection inside Kettu, built for fast reuse of photos you choose. This replaces the 0.1.x diagnostic builds. **It does not modify Discord's built-in Photos tray or automatically enumerate the phone's entire photo library.** It does not use `getPhotos` or `getDeviceMediaPhotos`.

## Using it

1. Update/reload the existing plugin, enable it, and confirm **0.2.0** in settings.
2. Open a chat, then **+ → Files**. The plugin replaces `handleAttachFile` with Quick Photos. Depending on the Discord build this action may be labelled Attach File.
3. Alternatively, run **/quickphotos** in that chat. The command opens the picker and returns no message to send. Plugin settings also have an **Open Quick Photos** button for the active chat.
4. Tap **Add photos**. Choose photos in Android's system picker and confirm your selection. This step is needed to add new photos; subsequent reuse happens in the custom collection.
5. Tap a photo to attach it to the current composer. Review the message and press Send yourself.

## Controls

- **3–6 columns:** fewer columns give larger previews.
- **Recently added / Oldest added / Filename:** dates are the time added to Quick Photos, not original photo capture dates.
- **Filename search**, **favorites filter**, and a star button on each photo. Holding a photo also toggles favorite.
- **Tap to attach**, or **Multi-select** then Attach, with a limit of 10 per batch.
- **Manage → Remove:** removes this collection entry and its private copy, if any. Original gallery photos are not deleted.
- Imports are limited to 100 per batch; the collection is capped at 1,000 photos.

## Private copies and temporary photos

When the client exposes Kettu's documented native file interface, the plugin reads selected local images and saves copies under `better-media-picker/photos/` in the app's private documents directory. The plugin stores only its own collection metadata and settings. Copies use device storage. They can survive ordinary app reloads, but clearing app data or uninstalling the app removes them.

Photos with unknown file size, size over 20 MiB, or a copy failure remain **Temporary**. If the native file interface is unavailable, all imported photos are temporary. These references stay only in memory; re-add them after Kettu reloads or when the original picker cache expires. Every tile is labelled **Saved** or **Temporary**. Duplicate detection uses the original URI; picking the same source again with a different cache URI may add another copy.

Removing a Saved item attempts to delete only its generated private copy. If native deletion fails, that copy may remain in app storage. Removing an entry never deletes the source photo. Uninstalling only the plugin may leave its private files behind; use Manage to remove saved entries first if desired.

## Status and testing limits

Local tests pass for the loader, custom modal, imports, private copies and temporary fallback, filters, favorites, multi-select, ten-photo cap, composer attachments, disabled fallback, file expiry, command behavior and cleanup. These use mocked Kettu/React Native interfaces. **The 0.2.0 UI and native file copying still need verification on the user's phone.** A working 0.1.x settings screen or module report does not establish these new paths work on-device.

The Files shortcut uses the existing Vendetta-family attachment hook and normal composer selection handler. If it cannot open the custom UI synchronously, it falls back to the original Files action. This plugin does not send messages, upload photos independently, collect diagnostics, or make network requests. Disabling it restores the normal Files flow.

## Hosting

The deployable files are `docs/BetterMediaPicker/index.js` and `manifest.json`. Publish GitHub Pages from **main /docs**. More plugins can use their own subfolders under docs.

Install the folder URL in Kettu:

`https://boyg22820-a11y.github.io/Discord-plug-ins-/BetterMediaPicker/`

## Validation

`node tests/smoke.mjs`

## Implementation references

- Kettu Vendetta compatibility API: https://github.com/C0C0B01/Kettu/blob/main/src/core/vendetta/api.tsx
- Kettu custom alert integration: https://github.com/C0C0B01/Kettu/blob/main/src/core/vendetta/alerts.ts
- Kettu native file interface: https://github.com/C0C0B01/Kettu/blob/main/src/lib/api/native/modules/types.ts
- Kettu command lifecycle: https://github.com/C0C0B01/Kettu/blob/main/src/lib/api/commands/index.ts
- Original Files action/composer bridge: https://github.com/fres621/vendetta-plugins/blob/master/plugins/AltMediaPicker/src/patch.ts
- Image picker contract: https://github.com/react-native-image-picker/react-native-image-picker
