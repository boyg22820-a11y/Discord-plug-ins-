# BetterMediaPicker · Quick Media 0.3.0

An experimental Kettu collection for quickly attaching photos and videos that you add. It does not automatically enumerate your whole phone gallery. Files remain local until you explicitly attach them to a message or export a backup. **The plugin never presses Send.**

## Update and open

Update/reload the existing plugin, enable it and check **0.3.0** in its settings. The same install URL is used:

`https://boyg22820-a11y.github.io/Discord-plug-ins-/BetterMediaPicker/`

- In a channel-message composer, **+** opens Quick Media **when the media-menu interface is found and its draft/channel arguments match**. The option is configurable. Other command/modal attachment menus retain their normal behavior.
- **Discord menu** opens the captured original menu, or arms a one-time bypass and asks you to press + again.
- **+ → Files / Attach File** is the existing fallback shortcut.
- **/quickphotos** and the plugin settings button also open the collection.
- Settings show whether each client hook is installed. A hook being installed is not proof that the corresponding control on every client build invokes it. Use **Retry client integrations** after opening the normal tray if needed.

## Included features

| Feature | Behavior and limits |
| --- | --- |
| Folders and tags | One virtual folder and multiple tags per item. Originals are not moved. Flat folders; no nested filesystem directories. |
| Import organization | Choose a folder, optional batch and comma-separated tags before Android opens. Import up to 100 selected media per operation. |
| Saved batches | Up to 10 items each; editable order, names, pins and membership. One tap adds the whole batch to the composer, preserving order. Existing composer uploads consume attachment slots. |
| Photos and videos | Mixed Android import, video cards with duration, correct video MIME/duration metadata when attaching. Photo detail preview and an external video-player action; embedded video playback/thumbnail generation is not implemented. External playback depends on URI permissions and an installed player. |
| Pinned and Recent | Pin folders/batches. Recent records successful additions to the composer, not confirmed message sends. |
| Bulk management | Select filtered items; move, add/clear tags, favorite, add to a batch or remove to trash. Up to 20 organization Undo steps per loaded session. |
| Removal and Undo | Removal retains private copies in trash; Undo restores collection/batch membership during the same session. Trash survives reload and can be restored. Empty trash permanently deletes only generated plugin copies and clears Undo history. Failed native deletions remain tracked. |
| Storage/repair | Saved/linked/missing indicators, saved-copy and trash byte totals, file checks, hash-verified re-selection where an original hash is available. Repair preserves item identity, folder, tags, favorites and batches. |
| Exact duplicates | SHA-256 on file contents. Native streaming hash where exposed; bounded pure-JavaScript fallback for readable files up to 20 MiB. Renamed identical bytes match. Crops, recompressed/edited files and visually similar media do not match. Unhashable files are reported as unchecked, not silently declared unique. |
| Duplicate merge | Merge verified identical-hash entries; preserve tags/favorites and remap batch membership. Extra copies go to trash and the operation supports Undo. |
| Per-chat browsing | Each DM/server channel keeps folder, tag, search, sort, media filter, favorites/recent state, scroll anchor/offset and last-used batch. Collection and default columns remain shared. |
| Confirmed-send badges | Correlates identifiable Quick Media upload items to the upload nonce, then requires a self-authored server message with matching attachment counts/filenames and server attachment IDs/URLs. Selecting, adding to composer or finishing an upload alone never counts. |
| Portable backups | Metadata includes folders/tags, pins, batches/order, preferences, per-chat state and recorded sends. Full backup includes a metadata JSON file plus each media file as an embedded JSON part or original-media part. Checksums are verified on restore. |

## Confirmed-send tracking boundaries

Tracking starts with this release and covers only Quick Media uploads whose upload options, message nonce and final attachment metadata can be correlated on that client. Renamed/recompressed uploads that no longer match may remain untracked. Hooks are capability-checked and fail closed. **No tracked send** is not a claim that an item was never sent. The plugin does not scan old messages, download chat attachments to compare them, track sends made on another device, or reliably identify sends made through another picker. It stores only the relevant channel/message IDs and send time/count; it does not save message text.

## Storage and large files

Selected readable files up to **20 MiB** can be copied into the app's private `better-media-picker/media/` directory using Kettu's native file interface. That size limit avoids loading a very large base64 string through the JavaScript bridge. Larger files, unknown-size files, and copy failures stay **Linked**. Linked metadata is persisted, but access to a picker URI/cache file may expire; use Repair to reconnect it. This is not durable ownership of the external original.

Native SHA-256 can hash large files without the JavaScript read limit, when that method/algorithm is supported. If hashing cannot be performed, the item remains unchecked. The collection supports up to 2,000 active items, 200 folders and 200 batches, and remembers browsing for up to 500 chats. Message/file-size limits imposed by Discord and the account still apply.

Files saved by older 0.2.0 installations migrate into the new database. The old `quickPhotos` metadata is left untouched as a recovery point. The temporary-only 0.2.0 in-memory collection cannot survive a reload.

## Backup and restore

Open the **Backup** tab:

1. **Prepare metadata backup** makes one JSON file without media bytes. **Prepare full media backup** first verifies that every media file can be read/hashed. It fails explicitly if it cannot include one, rather than silently producing an incomplete full backup.
2. Save **every part** outside Kettu using its Share button and Android's native share sheet. A share sheet opening is not confirmation that your chosen destination saved a file. Prepared files remaining inside Kettu are not a portable backup. Backups are unencrypted.
3. Media up to 20 MiB is embedded in separate checksummed JSON parts. Larger/unknown-size files are supplied as **original-media parts**, shared directly through the native interface without a full JavaScript read. Original filenames may be preserved by the share target; matching during restore uses content hashes.
4. After reinstalling, import all JSON parts with **Choose backup JSON files**. Their order does not matter. Files receive fresh private paths rather than using paths supplied by a backup.
5. If the backup includes original-media parts, use **Add media** to select those saved original files afterward. Matching hashes reconnect the missing entries and preserve organization. Large media remains linked; keep the external originals available. The Backup tab shows outstanding part counts.
6. Missing parts remain marked for repair. Metadata-only backups cannot recover media bytes by themselves. A failed file write is not recorded as a restored media part.

Restoration merges into the current collection and avoids overwriting unrelated media just because IDs or names happen to collide. Prepared backup copies can be removed through the Backup tab. This does not delete raw originals. Export/import/share native interfaces are checked at runtime; they still require on-device verification. Clipboard metadata transfer is available for small metadata backups if document sharing is unavailable.

## Build and validation

No build dependencies or network downloads are required:

```sh
node scripts/build.mjs
node tests/smoke.mjs
```

Editable code is split into `src/core.mjs` (collection model/hash), `src/platform.mjs` (native and Discord adapters) and `src/ui.mjs` (interface). The build emits identical standalone loader expressions to `index.js` and `docs/BetterMediaPicker/index.js`, and updates the manifest hash.

The local tests use mocks and cover migration, hashing against Node's SHA-256, duplicate handling, bulk Undo, batch limits/order, per-chat state, guarded + interception, upload/server-confirmation correlation, native file failures, backup round-trips including large raw-media parts, corruption rejection, repair, React hook stability, lifecycle cleanup and the emitted loader.

**Not device-tested:** this release's UI, + button integration, actual upload-event shape, native hashing/file access, Android file sharing and external video playback. Passing mocks confirms implementation behavior under those contracts; it does not establish compatibility with every Kettu/Discord build. Existing report: Kettu v1.4.3, Discord 351.11, React Native 0.86.0.

## Hosting and source references

Publish GitHub Pages from **main /docs**. Additional plugins can use separate subfolders in the same repository.

- Kettu compatibility API: https://github.com/C0C0B01/Kettu/blob/main/src/core/vendetta/api.tsx
- Kettu alert integration: https://github.com/C0C0B01/Kettu/blob/main/src/core/vendetta/alerts.ts
- Kettu native file types: https://github.com/C0C0B01/Kettu/blob/main/src/lib/api/native/modules/types.ts
- Kettu commands: https://github.com/C0C0B01/Kettu/blob/main/src/lib/api/commands/index.ts
- Original Files/composer bridge: https://github.com/fres621/vendetta-plugins/blob/master/plugins/AltMediaPicker/src/patch.ts
- React Native image/video picker: https://github.com/react-native-image-picker/react-native-image-picker
- Reconstructed Discord source was used to identify candidate media-menu, native share/hash and upload interfaces: https://github.com/Wumpus-Central/discord-mobile-datamining

Reconstructed source is a compatibility clue, not proof of the runtime interfaces in the user's exact app build. The adapters preserve original client behavior when their checked interfaces are unavailable.
