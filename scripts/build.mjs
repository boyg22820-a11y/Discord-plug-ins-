import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root=path.resolve(new URL('..',import.meta.url).pathname);
const sources=['core','platform','ui'].map(name=>fs.readFileSync(path.join(root,'src',name+'.mjs'),'utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,''));
const output=`(() => {\n"use strict";\n${sources.join('\n')}\nconst model=createModel(vendetta.plugin.storage);\nconst platform=createPlatform(vendetta,model);\nconst ui=createUI(vendetta,model,platform);\nreturn {onLoad:()=>platform.start(),onUnload:()=>platform.stop(),settings:ui.Settings};\n})()\n`;
fs.writeFileSync(path.join(root,'index.js'),output);fs.writeFileSync(path.join(root,'docs/BetterMediaPicker/index.js'),output);
const manifest=JSON.parse(fs.readFileSync(path.join(root,'docs/BetterMediaPicker/manifest.json'),'utf8'));manifest.version='0.3.0';manifest.description='Quick Media: folders, tags, ordered batches, photos/videos, per-chat browsing, bulk Undo, content hashes, storage/repair and portable backups. Discord integrations are capability-checked.';manifest.hash=crypto.createHash('sha256').update(output).digest('hex');fs.writeFileSync(path.join(root,'docs/BetterMediaPicker/manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(`Built ${output.length} characters · v${manifest.version} · ${manifest.hash.slice(0,12)}`);
