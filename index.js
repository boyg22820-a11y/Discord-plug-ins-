(() => {
  "use strict";
  const VERSION = "0.1.1";
  const COLS = [3, 4, 5, 6];
  const SORTS = ["newest", "oldest", "filename"];
  const unpatches = [];
  let runtime = "Not started";
  let active = false;

  const safeFind = (fn) => { try { return fn(); } catch (_) { return null; } };
  const metro = vendetta.metro;
  const React = metro.common.React;
  const RN = metro.common.ReactNative;
  const E = React.createElement;
  const storage = vendetta.plugin.storage;
  const getTarget = () => safeFind(() => metro.findByProps("handleAttachFile"));
  const getCameraRoll = () => safeFind(() => metro.findByProps("getPhotos"));
  const getNativePicker = () => safeFind(() => metro.findByProps("launchImageLibrary"));
  const getChannel = () => safeFind(() => metro.findByStoreName("SelectedChannelStore"));
  const getSheets = () => safeFind(() => metro.findByProps("openLazy", "hideActionSheet"));
  const notify = (message) => { try { vendetta.logger.log(`[BetterMediaPicker] ${message}`); } catch (_) {} };

  function initializeDefaults() {
    if (!COLS.includes(storage.columns)) storage.columns = 4;
    if (!SORTS.includes(storage.sort)) storage.sort = "newest";
    if (typeof storage.instant !== "boolean") storage.instant = true;
    if (typeof storage.enabled !== "boolean") storage.enabled = true;
  }
  const txt = (value, style) => E(RN.Text, { style: [
    { color: "#f2f3f5", fontSize: 14 }, style || {}
  ] }, value);
  const button = (text, press, selected, extraStyle) => E(RN.TouchableOpacity, {
    onPress: press, accessibilityRole: "button",
    style: [{ paddingVertical: 11, paddingHorizontal: 12, borderRadius: 9, margin: 3,
      backgroundColor: selected ? "#5865f2" : "#36393f" }, extraStyle || {}]
  }, txt(text, { fontWeight: selected ? "700" : "500", textAlign: "center" }));
  const heading = (label) => txt(label, { fontWeight: "700", marginTop: 14, marginBottom: 7, fontSize: 15 });

  function normalize(edge, index) {
    const n = edge && (edge.node || edge);
    const image = n && n.image;
    const uri = image && image.uri;
    if (!uri || typeof uri !== "string") return null;
    return {
      id: String(n.id || uri || index), uri,
      filename: String((image && (image.filename || image.fileName)) || n.filename || `image-${index}.jpg`),
      timestamp: Number(n.timestamp || n.modificationTimestamp || 0) || 0,
      height: Number((image && image.height) || 0) || 0,
      width: Number((image && image.width) || 0) || 0,
      mimeType: String(n.type || "image/jpeg"),
      playableDuration: Number((image && image.playableDuration) || 0) || 0
    };
  }

  function ordered(items, mode) {
    const result = items.slice();
    if (mode === "filename") result.sort((a, b) => a.filename.localeCompare(b.filename, undefined, { numeric: true }));
    else result.sort((a, b) => mode === "oldest" ? a.timestamp - b.timestamp : b.timestamp - a.timestamp);
    return result;
  }

  function hideSheet() {
    try { const m = getSheets(); if (m && typeof m.hideActionSheet === "function") m.hideActionSheet();
      else if (m && typeof m.close === "function") m.close();
    } catch (e) { notify(`Close failed: ${String(e)}`); }
  }

  function attachItems(items) {
    const target = getTarget();
    const store = getChannel();
    const channelId = store && (store.getChannelId && store.getChannelId());
    if (!channelId || !target || typeof target.handleSelectKeyboardItem !== "function") {
      throw new Error("Discord's attachment handler or selected channel is unavailable");
    }
    // Use Discord's actual composer selection handler, not a direct upload request.
    items.slice(0, 10).forEach((item) => {
      target.handleSelectKeyboardItem(channelId, {
        node: { image: {
          playableDuration: item.playableDuration, height: item.height,
          filename: item.filename, width: item.width,
          mimeType: item.mimeType, uri: item.uri
        }, type: "ALAssetTypePhoto" }
      }, false, { target: 0 }, undefined);
    });
  }

  function launchSystemPicker() {
    const native = getNativePicker();
    if (!native || typeof native.launchImageLibrary !== "function") {
      throw new Error("No native photo picker was exposed by this Discord version");
    }
    hideSheet();
    native.launchImageLibrary({ mediaType: "photo", selectionLimit: 10 }, (response) => {
      if (!response || response.didCancel || response.errorCode || !Array.isArray(response.assets)) return;
      const items = response.assets.slice(0, 10).filter(a => a && a.uri).map((a, i) => ({
        uri: a.uri, filename: a.fileName || `photo-${i}.jpg`,
        mimeType: a.type || "image/jpeg", width: a.width || 0,
        height: a.height || 0, playableDuration: 0
      }));
      try { if (items.length) attachItems(items); } catch (e) { notify(`Native attach: ${String(e)}`); }
    });
  }

  function Picker() {
    const [items, setItems] = React.useState([]);
    const [cursor, setCursor] = React.useState(null);
    const [hasNext, setHasNext] = React.useState(false);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState("");
    const [selection, setSelection] = React.useState([]);
    const [prefs, setPrefs] = React.useState({ columns: storage.columns, sort: storage.sort, instant: storage.instant });
    const [loadingCount, setLoadingCount] = React.useState(0);
    const viewportWidth = RN.Dimensions.get("window").width;
    const columns = COLS.includes(prefs.columns) ? prefs.columns : 4;
    const tile = Math.floor((viewportWidth - 34) / columns) - 4;

    async function loadMore(next) {
      const camera = getCameraRoll();
      if (!camera || typeof camera.getPhotos !== "function") {
        setError("This Discord build does not expose a compatible CameraRoll.getPhotos API.");
        return;
      }
      if (busy) return;
      setBusy(true);
      setError("");
      try {
        const params = { first: 120, assetType: "Photos", include: ["filename", "imageSize"] };
        if (next) params.after = next;
        const page = await camera.getPhotos(params);
        const edges = page && page.edges;
        if (!Array.isArray(edges)) throw new Error("Photo API returned an unexpected response");
        const mapped = edges.map(normalize).filter(Boolean);
        setItems(prev => {
          const seen = new Set(prev.map(a => a.id));
          return prev.concat(mapped.filter(a => !seen.has(a.id)));
        });
        const info = page.page_info || page.pageInfo || {};
        setCursor(info.end_cursor || info.endCursor || null);
        setHasNext(Boolean(info.has_next_page || info.hasNextPage));
        setLoadingCount(n => n + 1);
      } catch (e) { setError(String(e && e.message || e)); }
      finally { setBusy(false); }
    }
    React.useEffect(() => { loadMore(null); }, []);

    const sorted = ordered(items, prefs.sort);
    const selectedSet = new Set(selection.map(s => s.id));
    function selectPhoto(item) {
      if (prefs.instant) {
        try { attachItems([item]); hideSheet(); } catch (e) { setError(String(e && e.message || e)); }
        return;
      }
      setSelection(current => current.some(s => s.id === item.id)
        ? current.filter(s => s.id !== item.id)
        : current.length >= 10 ? current : current.concat([item]));
    }
    function attachSelected() {
      if (!selection.length) return;
      try { attachItems(selection); hideSheet(); } catch (e) { setError(String(e && e.message || e)); }
    }
    function changeColumns() {
      const i = COLS.indexOf(columns), next = COLS[(i + 1) % COLS.length];
      storage.columns = next; setPrefs(p => ({ ...p, columns: next }));
    }
    function changeSort() {
      const i = SORTS.indexOf(prefs.sort), next = SORTS[(i + 1) % SORTS.length];
      storage.sort = next; setPrefs(p => ({ ...p, sort: next }));
    }
    const imageGrid = E(RN.FlatList, {
      key: `grid-${columns}`,
      data: sorted,
      numColumns: columns,
      keyExtractor: (item, i) => `${item.id}:${i}`,
      initialNumToRender: columns * 8,
      windowSize: 5,
      style: { flexGrow: 0, maxHeight: RN.Dimensions.get("window").height * 0.57 },
      contentContainerStyle: { paddingBottom: 8 },
      renderItem: ({ item }) => E(RN.TouchableOpacity, {
        onPress: () => selectPhoto(item), accessibilityRole: "button",
        accessibilityLabel: `Attach ${item.filename}`,
        style: { width: tile, height: tile, margin: 2,
          borderWidth: selectedSet.has(item.id) ? 3 : 0,
          borderColor: "#5865f2", backgroundColor: "#313338", borderRadius: 4 }
      }, E(RN.Image, { source: { uri: item.uri }, resizeMode: "cover",
          style: { width: "100%", height: "100%", borderRadius: 4 } }),
        selectedSet.has(item.id) ? E(RN.View, { style: { position: "absolute", right: 3, top: 3,
          backgroundColor: "#5865f2", borderRadius: 9, paddingHorizontal: 5 } }, txt("✓")) : null),
      ListEmptyComponent: busy ? txt("Loading photos…") : txt(error ? "" : "No photos returned."),
      ListFooterComponent: hasNext ? button(busy ? "Loading…" : "Load more photos", () => loadMore(cursor), false) : null
    });
    return E(RN.View, { style: { backgroundColor: "#232428", padding: 10, borderRadius: 12,
      maxHeight: RN.Dimensions.get("window").height * 0.83 } },
      E(RN.View, { style: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" } },
        txt("BetterMediaPicker", { fontWeight: "700", fontSize: 17 }),
        button("Close", hideSheet, false)),
      E(RN.View, { style: { flexDirection: "row", flexWrap: "wrap" } },
        button(`${columns} columns`, changeColumns, true),
        button(`Sort: ${prefs.sort}`, changeSort, true),
        button("System picker", () => { try { launchSystemPicker(); } catch (e) { setError(String(e)); } }, false)),
      error ? txt(error, { color: "#ffb3b3", marginVertical: 8 }) : null,
      imageGrid,
      E(RN.View, { style: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" } },
        txt(`${items.length} loaded · ${loadingCount} page(s) · ${prefs.instant ? "tap to attach" : "multi-select"}`,
          { color: "#a8abb5", fontSize: 11 }),
        prefs.instant ? null : button(`Attach ${selection.length}`, attachSelected, !!selection.length))
    );
  }


  // Inspect only metadata of already initialized modules. Never require modules,
  // invoke exported methods, evaluate getters, or include property values.
  let diagnosticReport = "Open a chat, tap + and Photos, then return here and tap Scan loaded modules.";
  let scanGeneration = 0;
  let scanning = false;
  const relevantName = /camera.?roll|photo|gallery|(?:media|image|asset|attachment).*(?:picker|library)|(?:picker|library).*(?:media|image|asset|attachment)|^getAssets$|^getAlbums$|^handleSelectKeyboardItem$/i;
  const identifier = /^[A-Za-z_$][A-Za-z0-9_$]{0,95}$/;
  const ownValue = (object, key) => {
    if (!object || (typeof object !== "object" && typeof object !== "function")) return undefined;
    try { const d = Object.getOwnPropertyDescriptor(object, key); return d && d.value; }
    catch (_) { return undefined; }
  };
  const ownNames = object => {
    try { return Object.getOwnPropertyNames(object).filter(k => identifier.test(k)); }
    catch (_) { return []; }
  };
  function metadata(object) {
    if (!object || (typeof object !== "object" && typeof object !== "function")) return [];
    const hits = ownNames(object).filter(k => relevantName.test(k));
    for (const key of ["name", "displayName"]) {
      const name = ownValue(object, key);
      if (typeof name === "string" && identifier.test(name) && relevantName.test(name)) hits.push(name);
    }
    // React.memo / forwardRef wrappers, without traversing props or state.
    for (const key of ["render", "type"]) {
      const fn = ownValue(object, key);
      const name = ownValue(fn, "displayName") || ownValue(fn, "name");
      if (typeof name === "string" && identifier.test(name) && relevantName.test(name)) hits.push(name);
    }
    return Array.from(new Set(hits)).sort().slice(0, 16);
  }
  function diagnosticVersions() {
    const info = safeFind(() => vendetta.debug.getDebugInfo());
    const cleanVersion = v => typeof v === "string" || typeof v === "number"
      ? String(v).replace(/[^A-Za-z0-9 ._()+-]/g, "").slice(0, 80) : "unknown";
    return [
      `Plugin: ${VERSION}`,
      `Kettu: ${cleanVersion(info && info.bunny && info.bunny.version)}`,
      `Discord: ${cleanVersion(info && info.discord && info.discord.version)}`,
      `React Native: ${cleanVersion(info && info.react && info.react.nativeVersion)}`
    ];
  }
  async function scanLoadedModules() {
    if (scanning) return diagnosticReport;
    scanning = true;
    const generation = ++scanGeneration;
    const rows = diagnosticVersions();
    const modules = metro.modules;
    let loaded = 0, matched = 0, shown = 0;
    try {
      if (!modules || typeof modules !== "object") {
        rows.push("Loaded module registry unavailable on this client.");
      } else {
        const ids = Object.keys(modules).filter(id => /^\d+$/.test(id));
        for (let offset = 0; offset < ids.length; offset += 150) {
          if (generation !== scanGeneration) return diagnosticReport;
          for (const id of ids.slice(offset, offset + 150)) {
            const record = ownValue(modules, id);
            if (ownValue(record, "isInitialized") !== true || ownValue(record, "hasError")) continue;
            loaded++;
            const exports = ownValue(ownValue(record, "publicModule"), "exports");
            const hits = metadata(exports).concat(metadata(ownValue(exports, "default")));
            // Named exports may contain memoized or named picker components.
            for (const key of ownNames(exports).slice(0, 300)) {
              const child = ownValue(exports, key);
              if (typeof child === "function" || (child && typeof child === "object" && ownValue(child, "$$typeof"))) {
                hits.push(...metadata(child));
              }
            }
            if (hits.length) {
              matched++;
              if (shown++ < 120) rows.push(`Module ${id}: ${Array.from(new Set(hits)).slice(0, 16).join(", ")}`);
            }
          }
          await new Promise(resolve => setTimeout(resolve, 0));
        }
        rows.push(`Initialized modules: ${loaded}; matching modules: ${matched}; shown: ${Math.min(shown, 120)}`);
      }
      // List native module identifiers only. Never read module getters or invoke
      // native/turbo module lookup functions based on guessed module names.
      const native = RN.NativeModules;
      if (native) rows.push("Native names: " + ownNames(native).filter(k => relevantName.test(k)).slice(0, 60).join(", "));
      rows.push("Metadata only. No photos, filenames, paths, messages, account IDs, or tokens are collected. No automatic upload.");
      if (generation === scanGeneration) diagnosticReport = rows.join("\n");
    } catch (_) {
      if (generation === scanGeneration) diagnosticReport = rows.concat("Scan could not finish on this client.").join("\n");
    } finally {
      if (generation === scanGeneration) scanning = false;
    }
    return diagnosticReport;
  }

  function Settings() {
    const [refresh, setRefresh] = React.useState(0);
    const [report, setReport] = React.useState(diagnosticReport);
    const [busy, setBusy] = React.useState(false);
    const [copyStatus, setCopyStatus] = React.useState("");
    const mounted = React.useRef(true);
    React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    function change(key, val) { storage[key] = val; setRefresh(n => n + 1); }
    return E(RN.ScrollView, { style: { flex: 1, backgroundColor: "#232428" },
      contentContainerStyle: { padding: 16, paddingBottom: 50 } },
      heading("BetterMediaPicker · prototype " + VERSION),
      txt("Status: " + runtime, { color: "#b6bbc6", marginBottom: 10 }),
      txt("Replaces Discord's Attach File action with an in-Discord gallery when the CameraRoll bridge and custom alert are available. If unavailable, normal Discord behavior remains.",
        { color: "#b6bbc6", marginBottom: 10 }),
      heading("Photos tray investigation"),
      txt("This update diagnoses the built-in + → Photos tray. It does not resize or sort that tray yet. Open it once before scanning. The controls below apply only to the older experimental Files gallery.", { color: "#ffdb99", marginBottom: 10 }),
      button(busy ? "Scanning…" : "Scan loaded modules", async () => {
        if (busy) return;
        setBusy(true);
        try { const result = await scanLoadedModules(); if (mounted.current) setReport(result); }
        finally { if (mounted.current) setBusy(false); }
      }, false),
      button("Copy diagnostic report", () => {
        try {
          const clipboard = metro.common.clipboard;
          if (!clipboard || typeof clipboard.setString !== "function") throw new Error();
          clipboard.setString(report);
          setCopyStatus("Copied. Paste the report into this ChatGPT conversation.");
        } catch (_) { setCopyStatus("Copy unavailable. Select the report text or take screenshots."); }
      }, false),
      txt(copyStatus, { color: "#b6bbc6", marginVertical: 5 }),
      E(RN.Text, { selectable: true, style: { color: "#d3d6df", fontSize: 12, marginVertical: 10 } }, report),
      heading("Experimental Files gallery"),
      button(storage.enabled ? "Enabled (tap to disable)" : "Disabled (tap to enable)",
        () => change("enabled", !storage.enabled), !!storage.enabled),
      heading("Photo columns"),
      E(RN.View, { style: { flexDirection: "row", flexWrap: "wrap" } },
        COLS.map(c => E(React.Fragment, { key: c }, button(String(c), () => change("columns", c), storage.columns === c)))),
      heading("Sort currently loaded photos"),
      E(RN.View, { style: { flexDirection: "row", flexWrap: "wrap" } },
        SORTS.map(s => E(React.Fragment, { key: s }, button(s, () => change("sort", s), storage.sort === s)))),
      heading("Selection behavior"),
      button(storage.instant ? "Single-tap attachment (fastest)" : "Multi-select then Attach",
        () => change("instant", !storage.instant), true),
      txt("Sorting affects fetched photos only (initially up to 120, then Load more). Oldest and filename do not query your entire library. Only photos are supported in v0.1.0.",
        { color: "#b6bbc6", marginTop: 15, fontSize: 12 }),
      heading("Diagnostics"),
      txt(`Media bridge: ${getCameraRoll() ? "Found" : "Not found"}`),
      txt(`Native fallback picker: ${getNativePicker() ? "Found" : "Not found"}`),
      txt(`Discord attach hook: ${getTarget() ? "Found" : "Not found"}`),
      txt(`Sheet UI: ${typeof vendetta.ui.alerts.showCustomAlert === "function" ? "Found" : "Not found"}`)
    );
  }

  return {
    onLoad() {
      initializeDefaults();
      const target = getTarget();
      const api = getCameraRoll();
      const alertFn = vendetta.ui && vendetta.ui.alerts && vendetta.ui.alerts.showCustomAlert;
      if (!target || typeof target.handleAttachFile !== "function") {
        runtime = "Attachment hook missing (no modification applied)"; notify(runtime); return;
      }
      if (!api || typeof api.getPhotos !== "function" || typeof alertFn !== "function") {
        runtime = "Custom gallery bridge missing (normal Discord picker preserved)"; notify(runtime); return;
      }
      try {
        const unpatch = vendetta.patcher.instead("handleAttachFile", target, (args, original) => {
          if (!storage.enabled) return original(...args);
          try { return alertFn(Picker, {}); }
          catch (err) { notify(`Opening custom picker failed: ${String(err)}`); return original(...args); }
        });
        unpatches.push(unpatch);
        active = true;
        runtime = "Hook installed. Open + → Attach File to test.";
        notify(runtime);
      } catch (e) {
        runtime = "Patch failed: " + String(e);
        notify(runtime);
      }
    },
    onUnload() {
      scanGeneration++;
      scanning = false;
      while (unpatches.length) { try { unpatches.pop()(); } catch (_) {} }
      active = false;
      runtime = "Unloaded";
    },
    settings: Settings
  };
})()
