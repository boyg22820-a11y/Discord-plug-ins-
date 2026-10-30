# GitHub Pages setup on Samsung Android

These instructions make a reusable GitHub Pages repository for BetterMediaPicker and any later plugins.

1. Extract `BetterMediaPicker_Kettu_GitHub_Pages_Ready.zip` in Samsung **My Files**. The deployable files are under `docs/`.
2. In Chrome, sign into [github.com](https://github.com) and make a **new public repository** named `discord-plugins`. Tick **Add a README file** and create the repository. GitHub Pages publishing from a branch requires a public repository on GitHub Free.
3. On the repository's **Code** page choose **Add file → Create new file**. In the filename box enter `docs/BetterMediaPicker/README.md` (GitHub creates these directories when you type `/`). Put `BetterMediaPicker plugin deployment files.` in the editor, then **Commit changes** to `main`.
4. Browse to `docs/BetterMediaPicker/` in the repository, choose **Add file → Upload files → choose your files**. In Samsung Files find the *extracted* `docs/BetterMediaPicker/` and select **`index.js` and `manifest.json`**. Confirm they are uploading into **`docs/BetterMediaPicker/`**, then commit directly to `main`.
5. Browse to the repository's `docs/` folder and **Add file → Upload files**. Upload `docs/index.html` from your extracted ZIP, and optionally `docs/.nojekyll` (some Android file pickers hide dotfiles). Commit. `docs/index.html` is required for a normal Pages landing page.
6. Open repository **Settings → Pages** (Chrome's **Desktop site** option can help if the tabs do not fit). Under **Build and deployment**, set **Source: Deploy from a branch**, **Branch: main**, **Folder: /docs**, then **Save**. Check the Actions tab if publishing fails.
7. Open in Chrome: `https://YOUR_USERNAME.github.io/discord-plugins/BetterMediaPicker/manifest.json` (replace YOUR_USERNAME). It should display the JSON text, **not** a 404 or GitHub repository page.
8. In Kettu/Discord, open **Settings → Plugins → +**. Install the *folder URL*, not the ZIP or the manifest file:
   `https://YOUR_USERNAME.github.io/discord-plugins/BetterMediaPicker/`
9. Enable it, reload the client if needed, test **+ → Attach File** in a safe chat, and check the plugin diagnostics. It is experimental. If it fails, disable it and report Kettu/Discord versions and non-sensitive diagnostic text.

## Reusing the repository

For the next plugin, upload its `index.js` and `manifest.json` to `docs/NextPlugin/` and install the corresponding URL `https://YOUR_USERNAME.github.io/discord-plugins/NextPlugin/`. You **do not** need a new repo or a new Pages setup.

**Safety:** A public GitHub Pages repository makes the code accessible to others. Do not upload Discord tokens, credentials, backups or personal media. The test plugin is not guaranteed to work with your specific Kettu/Discord build, and third-party client modifications may introduce security or account risks.
