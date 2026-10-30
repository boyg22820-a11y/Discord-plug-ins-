(() => {
  "use strict";
  const VERSION = "0.2.0";
  const MAX_COLLECTION = 1000;
  const MAX_BATCH = 10;
  const MAX_COPY_BYTES = 20 * 1024 * 1024;
  const COPY_PREFIX = "better-media-picker/photos/";
  const COLS = [3, 4, 5, 6];
  const SORTS = ["newest", "oldest", "filename"];
  const SORT_LABELS = { newest: "Recently added", oldest: "Oldest added", filename: "Filename" };
  const metro = vendetta.metro;
  const React = metro.common.React;
  const RN = metro.common.ReactNative;
  const E = React.createElement;
  const storage = vendetta.plugin.storage;
  const cleanups = [];
  const pendingPicks = new Set();
  const openViews = new Set();
  let temporaryPhotos = [];
  let running = false;
  let generation = 0;
  let pickerOpen = false;
  let importBusy = false;
  let runtime = "Not started";
  let lastNotice = "";
  const safe = fn => { try { return fn(); } catch (_) { return null; } };
  const find = (...props) => safe(() => metro.findByProps(...props));
  const target = () => find("handleAttachFile", "handleSelectKeyboardItem");
  const channelStore = () => safe(() => metro.findByStoreName("SelectedChannelStore"));
  const currentChannel = () => safe(() => channelStore().getChannelId());
  const tell = text => { lastNotice = text; safe(() => vendetta.ui.toasts.showToast(text)); };
  function defaults() {
    if (!COLS.includes(storage.columns)) storage.columns = 4;
    if (!SORTS.includes(storage.sort)) storage.sort = "newest";
    if (typeof storage.instant !== "boolean") storage.instant = true;
    if (typeof storage.enabled !== "boolean") storage.enabled = true;
    if (!Array.isArray(storage.quickPhotos)) storage.quickPhotos = [];
  }
  function fileManager() {
    for (const name of ["NativeFileModule", "RTNFileManager", "DCDFileManager"]) {
      const native = safe(() => RN.NativeModules && RN.NativeModules[name]) ||
        safe(() => globalThis.__turboModuleProxy && globalThis.__turboModuleProxy(name));
      if (native && typeof native.readFile === "function" && typeof native.writeFile === "function" && typeof native.getConstants === "function") return native;
    }
    const fallback = find("readFile", "writeFile", "getConstants");
    return fallback && typeof fallback.readFile === "function" && typeof fallback.writeFile === "function" ? fallback : null;
  }
  function isManaged(name) {
    return typeof name === "string" && /^better-media-picker\/photos\/[a-z0-9_-]+\.(jpg|png|gif|webp|heic|heif|avif)$/.test(name);
  }
  async function deleteCopy(item) {
    if (!isManaged(item.managedPath)) return;
    const fm = fileManager();
    if (fm && typeof fm.removeFile === "function") {
      try { await fm.removeFile("documents", item.managedPath); } catch (_) {}
    }
  }
  function collection() { return [...storage.quickPhotos, ...temporaryPhotos]; }
  function setFavorite(id) {
    storage.quickPhotos = storage.quickPhotos.map(p => p.id === id ? { ...p, favorite: !p.favorite } : p);
    temporaryPhotos = temporaryPhotos.map(p => p.id === id ? { ...p, favorite: !p.favorite } : p);
  }
  async function removePhoto(id) {
    const item = collection().find(p => p.id === id);
    if (!item) return;
    storage.quickPhotos = storage.quickPhotos.filter(p => p.id !== id);
    temporaryPhotos = temporaryPhotos.filter(p => p.id !== id);
    await deleteCopy(item);
  }
  function ordered(items, mode) {
    return items.slice().sort((a, b) => mode === "filename"
      ? a.filename.localeCompare(b.filename, undefined, { numeric: true })
      : mode === "oldest" ? a.addedAt - b.addedAt : b.addedAt - a.addedAt);
  }
  function pickPhotos() {
    const api = find("launchImageLibrary");
    if (!api || typeof api.launchImageLibrary !== "function") return Promise.reject(new Error("Android picker unavailable"));
    return new Promise((resolve, reject) => {
      let done = false;
      const cancel = () => finish({ didCancel: true });
      const finish = response => {
        if (done) return;
        done = true;
        pendingPicks.delete(cancel);
        resolve(response || { didCancel: true });
      };
      pendingPicks.add(cancel);
      try {
        const result = api.launchImageLibrary({ mediaType: "photo", selectionLimit: 100 }, finish);
        if (result && typeof result.then === "function") result.then(finish, () => {
          if (!done) { done = true; pendingPicks.delete(cancel); reject(new Error("Android picker failed")); }
        });
      } catch (_) { done = true; pendingPicks.delete(cancel); reject(new Error("Android picker could not open")); }
    });
  }
  function normalizeAsset(asset, index) {
    if (!asset || typeof asset.uri !== "string" || !/^(file|content):\/\//.test(asset.uri)) return null;
    if (asset.type && !String(asset.type).startsWith("image/")) return null;
    const type = typeof asset.type === "string" ? asset.type : "image/jpeg";
    const filename = String(asset.fileName || asset.filename || `photo-${index + 1}.jpg`);
    const id = `${Date.now().toString(36)}-${index.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    return { id, uri: asset.uri, sourceKey: asset.uri,
      filename, mimeType: type, width: Number(asset.width) || 0, height: Number(asset.height) || 0,
      fileSize: Number(asset.fileSize) || 0, addedAt: Date.now() + index, favorite: false };
  }
  async function keepCopy(item, fm) {
    if (!fm || item.fileSize <= 0 || item.fileSize > MAX_COPY_BYTES) return item;
    let managedPath;
    try {
      const constants = fm.getConstants();
      const documents = constants && constants.DocumentsDirPath;
      if (typeof documents !== "string" || !documents.startsWith("/")) return item;
      const extByType = { "image/png": "png", "image/gif": "gif", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif", "image/avif": "avif" };
      const ext = extByType[item.mimeType] || "jpg";
      managedPath = COPY_PREFIX + item.id + "." + ext;
      const path = item.uri.startsWith("file://") ? decodeURI(item.uri.slice(7)) : item.uri;
      const base64 = await fm.readFile(path, "base64");
      if (typeof base64 !== "string" || !base64.length || base64.length > Math.ceil(MAX_COPY_BYTES / 3) * 4) return item;
      await fm.writeFile("documents", managedPath, base64, "base64");
      const full = documents.replace(/\/$/, "") + "/" + managedPath;
      // Where supported, verify that the native write produced a usable file.
      if (typeof fm.fileExists === "function" && !(await fm.fileExists(full))) {
        await deleteCopy({ managedPath }); return item;
      }
      return { ...item, uri: "file://" + full, managedPath };
    } catch (_) {
      if (managedPath) await deleteCopy({ managedPath });
      return item;
    }
  }
  async function addPhotos(onProgress) {
    if (importBusy) return { message: "Another import is already open." };
    if (collection().length >= MAX_COLLECTION) return { message: "Collection full. Remove some photos first." };
    importBusy = true;
    const token = generation;
    let added = 0, saved = 0, duplicates = 0;
    try {
      const response = await pickPhotos();
      if (!running || token !== generation || response.didCancel) return { message: "Import cancelled." };
      if (response.errorCode || !Array.isArray(response.assets)) return { message: "Android did not return photos. Try Add photos again." };
      const fm = fileManager();
      const existing = new Set(collection().map(p => p.sourceKey));
      const room = MAX_COLLECTION - collection().length;
      const assets = response.assets.slice(0, Math.min(100, room));
      for (let i = 0; i < assets.length; i++) {
        if (!running || token !== generation) break;
        let item = normalizeAsset(assets[i], i);
        if (!item) continue;
        if (existing.has(item.sourceKey)) { duplicates++; continue; }
        item = await keepCopy(item, fm);
        if (!running || token !== generation) { await deleteCopy(item); break; }
        if (item.managedPath) { storage.quickPhotos = [...storage.quickPhotos, item]; saved++; }
        else temporaryPhotos.push(item);
        existing.add(item.sourceKey); added++;
        if (onProgress) onProgress(added);
      }
      const limited = response.assets.length > assets.length ? " Selection exceeded the import limit; add the rest in another batch." : "";
      const temp = added - saved;
      return { message: `Added ${added} photo(s). ${saved} saved locally.` +
        (temp ? ` ${temp} temporary: re-add if the previews expire or Kettu reloads.` : "") +
        (duplicates ? ` ${duplicates} duplicate(s) skipped.` : "") + limited };
    } catch (_) { return { message: "Import could not finish. Try Add photos again." }; }
    finally { if (token === generation) importBusy = false; }
  }
  async function attachPhotos(items, channelId) {
    if (!running) throw new Error("Plugin is disabled.");
    if (!channelId || currentChannel() !== channelId) throw new Error("Return to the chat where you opened Quick Photos.");
    const api = target();
    if (!api || typeof api.handleSelectKeyboardItem !== "function") throw new Error("Attachment interface unavailable on this build.");
    const fm = fileManager();
    const batch = items.slice(0, MAX_BATCH);
    // Validate known file copies before touching the composer.
    if (fm && typeof fm.fileExists === "function") {
      for (const item of batch) {
        if (item.uri.startsWith("file://") && !(await fm.fileExists(decodeURI(item.uri.slice(7))))) {
          throw new Error("A photo is no longer available. Remove it from Quick Photos and add it again.");
        }
      }
    }
    if (!running || currentChannel() !== channelId) throw new Error("The active chat changed. Open Quick Photos again.");
    for (const item of batch) {
      try {
        api.handleSelectKeyboardItem(channelId, { node: { image: {
          playableDuration: 0, height: item.height, filename: item.filename,
          width: item.width, mimeType: item.mimeType, uri: item.uri
        }, type: "ALAssetTypePhoto" } }, false, { target: 0 }, undefined);
      } catch (_) { throw new Error("Could not attach every photo. Check the composer before trying again."); }
    }
  }
  function closeAlert() { safe(() => find("openLazy", "close").close()); }
  const txt = (text, style) => E(RN.Text, { style: [{ color: "#f2f3f5", fontSize: 14 }, style] }, text);
  const button = (label, onPress, selected = false, disabled = false) => E(RN.TouchableOpacity, {
    onPress, disabled, accessibilityRole: "button", accessibilityLabel: label,
    style: { paddingVertical: 10, paddingHorizontal: 12, margin: 3, borderRadius: 10,
      backgroundColor: selected ? "#5865f2" : "#36393f", opacity: disabled ? 0.5 : 1 }
  }, txt(label, { textAlign: "center", fontWeight: "600" }));
  const row = (...children) => E(RN.View, { style: { flexDirection: "row", flexWrap: "wrap", alignItems: "center" } }, ...children);
  const heading = label => txt(label, { fontSize: 17, fontWeight: "700", marginTop: 18, marginBottom: 8 });

  function Picker({ channelId }) {
    const [items, setItems] = React.useState(collection());
    const [columns, setColumns] = React.useState(storage.columns);
    const [sort, setSort] = React.useState(storage.sort);
    const [instant, setInstant] = React.useState(storage.instant);
    const [favorites, setFavorites] = React.useState(false);
    const [query, setQuery] = React.useState("");
    const [selection, setSelection] = React.useState([]);
    const [managing, setManaging] = React.useState(false);
    const [busy, setBusy] = React.useState(false);
    const [notice, setNotice] = React.useState("");
    const [visible, setVisible] = React.useState(true);
    const [failed, setFailed] = React.useState([]);
    const [panelWidth, setPanelWidth] = React.useState(RN.Dimensions.get("window").width);
    const mounted = React.useRef(true);
    const locked = React.useRef(false);
    const close = () => { setVisible(false); pickerOpen = false; closeAlert(); };
    React.useEffect(() => {
      mounted.current = true; openViews.add(close);
      return () => { mounted.current = false; openViews.delete(close); pickerOpen = false; };
    }, []);
    function refresh() { if (mounted.current) setItems(collection()); }
    async function importMore() {
      if (locked.current) return;
      locked.current = true; setBusy(true); setNotice("Choose photos in Android's picker. Selected photos will be copied into Kettu when supported.");
      try {
        const result = await addPhotos(count => { if (mounted.current) { refresh(); setNotice(`Adding photos… ${count}`); } });
        if (mounted.current) { refresh(); setNotice(result.message); }
      } finally { locked.current = false; if (mounted.current) setBusy(false); }
    }
    async function attach(batch) {
      if (locked.current || !batch.length) return;
      locked.current = true; setBusy(true);
      try { await attachPhotos(batch, channelId); close(); }
      catch (error) { if (mounted.current) setNotice(error.message); }
      finally { locked.current = false; if (mounted.current) setBusy(false); }
    }
    function select(item) {
      if (busy || managing) return;
      if (failed.includes(item.id)) { setNotice("This preview failed. Remove this photo and add it again."); return; }
      if (instant) return attach([item]);
      setSelection(ids => ids.includes(item.id) ? ids.filter(id => id !== item.id)
        : ids.length < MAX_BATCH ? [...ids, item.id] : ids);
    }
    const filtered = ordered(items.filter(item => (!favorites || item.favorite) &&
      item.filename.toLowerCase().includes(query.trim().toLowerCase())), sort);
    const tile = Math.max(30, Math.floor((panelWidth - 24) / columns) - 4);
    const content = E(RN.View, { onLayout: event => {
      const width = event && event.nativeEvent && event.nativeEvent.layout.width;
      if (width > 0) setPanelWidth(width);
    }, style: { flex: 1, backgroundColor: "#202127", paddingHorizontal: 12, paddingTop: 14, paddingBottom: 18 } },
      row(txt("Quick Photos", { flex: 1, fontSize: 23, fontWeight: "800" }), button("Close", close, false, busy)),
      txt(`${items.length} photos · ${items.filter(p => p.favorite).length} favorites`, { color: "#a8abb5", marginVertical: 5 }),
      row(button("Add photos", importMore, true, busy),
        button(`${columns} columns`, () => { const c = COLS[(COLS.indexOf(columns) + 1) % COLS.length]; storage.columns = c; setColumns(c); }, false, busy),
        button(SORT_LABELS[sort], () => { const v = SORTS[(SORTS.indexOf(sort) + 1) % SORTS.length]; storage.sort = v; setSort(v); }, false, busy)),
      row(button(favorites ? "Favorites only" : "All photos", () => setFavorites(v => !v), favorites, busy),
        button(instant ? "Tap to attach" : "Multi-select", () => { storage.instant = !instant; setInstant(v => !v); setSelection([]); }, instant, busy),
        button(managing ? "Done managing" : "Manage", () => { setManaging(v => !v); setSelection([]); }, managing, busy)),
      E(RN.TextInput, { value: query, onChangeText: setQuery, placeholder: "Search added photos by filename", placeholderTextColor: "#969baa",
        accessibilityLabel: "Search added photos", editable: !busy, style: { color: "#f2f3f5", backgroundColor: "#303239", borderRadius: 10, padding: 10, marginVertical: 8 } }),
      notice ? txt(notice, { color: "#ffdb99", fontSize: 12, marginBottom: 6 }) : null,
      txt(managing ? "Remove only deletes the Quick Photos copy; your original stays in your gallery." : "Tap ★ or hold a photo to favorite it. Photos attach to the composer for you to review.", { color: "#a8abb5", fontSize: 11, marginBottom: 8 }),
      E(RN.FlatList, { key: `quick-grid-${columns}`, data: filtered, numColumns: columns, keyExtractor: item => item.id,
        style: { flex: 1 }, initialNumToRender: columns * 6, windowSize: 5, extraData: [selection, managing, failed],
        renderItem: ({ item }) => E(RN.View, { style: { width: tile, margin: 2 } },
          E(RN.TouchableOpacity, { onPress: () => select(item), onLongPress: () => { if (!busy) { setFavorite(item.id); refresh(); } },
            disabled: busy || managing, accessibilityRole: "button", accessibilityLabel: item.filename,
            style: { width: tile, height: tile, borderRadius: 8, overflow: "hidden", borderWidth: selection.includes(item.id) ? 3 : 0,
              borderColor: "#5865f2", backgroundColor: "#36393f" } },
            failed.includes(item.id) ? txt("Unavailable\nRe-add photo", { textAlign: "center", marginTop: 12, fontSize: 11 }) :
              E(RN.Image, { source: { uri: item.uri }, resizeMode: "cover", onError: () => setFailed(ids => ids.includes(item.id) ? ids : [...ids, item.id]),
                style: { width: "100%", height: "100%" } }),
            selection.includes(item.id) ? E(RN.View, { style: { position: "absolute", left: 3, top: 3, backgroundColor: "#5865f2", padding: 3, borderRadius: 5 } }, txt("✓")) : null),
          E(RN.TouchableOpacity, { accessibilityRole: "button", accessibilityLabel: item.favorite ? "Remove favorite" : "Favorite photo",
            disabled: busy, onPress: () => { setFavorite(item.id); refresh(); },
            style: { position: "absolute", top: 2, right: 2, borderRadius: 9, backgroundColor: "#202127dd", padding: 5 } }, txt(item.favorite ? "★" : "☆", { color: "#ffdb78", fontSize: 19 })),
          managing ? button("Remove", async () => {
            if (locked.current) return;
            locked.current = true; setBusy(true);
            try { await removePhoto(item.id); refresh(); }
            finally { locked.current = false; if (mounted.current) setBusy(false); }
          }, false, busy) : null,
          txt(item.managedPath ? "Saved" : "Temporary", { color: "#a8abb5", fontSize: 10, paddingVertical: 3 })),
        ListEmptyComponent: E(RN.View, { style: { padding: 22 } },
          txt(items.length ? "No matching photos." : "Build your Quick Photos collection", { textAlign: "center", fontWeight: "700", marginBottom: 10 }),
          txt(items.length ? "Change the search or favorites filter." : "Tap Add photos and choose a batch. They’ll appear here for quick reuse. This collection contains only photos you add.", { textAlign: "center", color: "#a8abb5" })) }),
      !instant && !managing ? button(`Attach ${selection.length} / ${MAX_BATCH}`, () => attach(items.filter(item => selection.includes(item.id))), true, busy || !selection.length) : null
    );
    return E(RN.Modal, { visible, animationType: "slide", presentationStyle: "fullScreen", onRequestClose: () => { if (!locked.current) close(); } },
      E(RN.SafeAreaView || RN.View, { style: { flex: 1, backgroundColor: "#202127" } }, content));
  }
  function openPicker(channelId) {
    if (!running || !storage.enabled) { tell("Enable Quick Photos in plugin settings first."); return; }
    if (pickerOpen) return;
    const alerts = vendetta.ui && vendetta.ui.alerts;
    if (!alerts || typeof alerts.showCustomAlert !== "function" || !RN.Modal) throw new Error("Custom picker UI unavailable.");
    if (!channelId) throw new Error("Open a chat before opening Quick Photos.");
    pickerOpen = true;
    try {
      const result = alerts.showCustomAlert(Picker, { channelId });
      if (result && typeof result.catch === "function") result.catch(() => { pickerOpen = false; tell("Quick Photos could not open on this build."); });
    } catch (error) { pickerOpen = false; throw error; }
  }
  function Settings() {
    const [, update] = React.useState(0);
    const [notice, setNotice] = React.useState("");
    const refresh = () => update(v => v + 1);
    return E(RN.ScrollView, { style: { flex: 1, backgroundColor: "#202127" }, contentContainerStyle: { padding: 16, paddingBottom: 48 } },
      heading("BetterMediaPicker · " + VERSION),
      txt(runtime, { color: "#a8abb5", marginBottom: 8 }),
      txt("A custom collection for fast photo reuse. Add photos once through Android's picker, then attach them from your own grid. The built-in Photos tray is unchanged."),
      row(button(storage.enabled ? "Enabled" : "Disabled", () => { storage.enabled = !storage.enabled; refresh(); }, storage.enabled),
        button("Open Quick Photos", () => { try { openPicker(currentChannel()); } catch (e) { setNotice(e.message); } }, true)),
      heading("How to open"),
      txt("In a chat: + → Files opens Quick Photos when the attachment hook is available. You can also run /quickphotos. Neither action sends a message."),
      heading("Your collection"),
      txt(`${storage.quickPhotos.length} saved · ${temporaryPhotos.length} temporary`),
      txt("When Kettu's file interface supports it, imports create private copies inside the app. Copies use device storage. Photos that cannot be copied are marked Temporary and must be re-added after reload or cache expiry.", { color: "#a8abb5", marginTop: 8 }),
      heading("Default columns"),
      row(...COLS.map(n => button(String(n), () => { storage.columns = n; refresh(); }, storage.columns === n))),
      heading("Default sort"),
      row(...SORTS.map(mode => button(SORT_LABELS[mode], () => { storage.sort = mode; refresh(); }, storage.sort === mode))),
      txt("Dates refer to when you added photos to Quick Photos, not when the original photos were taken.", { color: "#a8abb5", fontSize: 12, marginTop: 6 }),
      heading("Selection"),
      button(storage.instant ? "Single tap attaches" : "Multi-select, then Attach", () => { storage.instant = !storage.instant; refresh(); }, storage.instant),
      txt("Up to 10 photos per attachment batch. You review the message and press Send yourself. Manage → Remove deletes only this plugin's saved copy/reference."),
      notice || lastNotice ? txt(notice || lastNotice, { color: "#ffdb99", marginVertical: 12 }) : null
    );
  }
  return {
    onLoad() {
      defaults(); running = true; generation++;
      let hooked = false, command = false;
      const api = target();
      if (api && typeof api.handleAttachFile === "function") {
        try {
          cleanups.push(vendetta.patcher.instead("handleAttachFile", api, (args, original) => {
            if (!storage.enabled) return original(...args);
            try { openPicker(currentChannel()); }
            catch (_) { tell("Quick Photos could not open; using the normal attachment picker."); return original(...args); }
          }));
          hooked = true;
        } catch (_) {}
      }
      if (vendetta.commands && typeof vendetta.commands.registerCommand === "function") {
        try {
          const unregister = vendetta.commands.registerCommand({ name: "quickphotos", description: "Open your Quick Photos collection without sending a message", options: [],
            execute(_args, ctx) { try { openPicker(ctx && ctx.channel && ctx.channel.id); } catch (e) { tell(e.message); } } });
          if (typeof unregister === "function") cleanups.push(unregister);
          command = true;
        } catch (_) {}
      }
      runtime = `Quick Photos ${VERSION} · Files shortcut: ${hooked ? "ready" : "unavailable"} · /quickphotos: ${command ? "ready" : "unavailable"}`;
    },
    onUnload() {
      running = false; generation++; importBusy = false;
      for (const cancel of pendingPicks) cancel();
      pendingPicks.clear();
      for (const close of openViews) safe(close);
      openViews.clear(); pickerOpen = false;
      while (cleanups.length) safe(cleanups.pop());
      temporaryPhotos = []; runtime = "Unloaded";
    },
    settings: Settings
  };
})()
