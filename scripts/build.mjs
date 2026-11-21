import { readFile, writeFile, mkdir } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const [core, app, style, demoData, template] = await Promise.all(['src/core.js', 'src/app.js', 'src/style.css', 'demo/data.js', 'demo/template.html'].map(path => readFile(new URL(path, root), 'utf8')));
const metadata = `// ==UserScript==
// @name         PKU Treehole · Daily Digest
// @namespace    treehole-daily-digest.local
// @version      0.1.0
// @author       Kristina
// @homepageURL  https://github.com/KristinaYuan/TreeholeDailyDigest
// @updateURL    https://github.com/KristinaYuan/TreeholeDailyDigest/releases/latest/download/treehole-digest.user.js
// @downloadURL  https://github.com/KristinaYuan/TreeholeDailyDigest/releases/latest/download/treehole-digest.user.js
// @description  今日热门、关键词订阅与短期缓存；复用网页登录态，不向第三方发送内容。
// @match        https://treehole.pku.edu.cn/ch/web/*
// @match        https://treehole.pku.edu.cn/web/*
// @run-at       document-end
// @grant        none
// @noframes
// ==/UserScript==
`;
const styleScript = `globalThis.TreeholeDigestStyle = ${JSON.stringify(style)};\n`;
await mkdir(new URL('dist/', root), { recursive: true });
await writeFile(new URL('dist/treehole-digest.user.js', root), `${metadata}\n(function () {\n${core}\n${styleScript}\n${app}\n})();\n`);
const inline = [core, styleScript, demoData, app].map(source => `<script>\ntry {\n${source.replace(/<\/script/gi, '<\\/script')}\n} catch (error) { const note = document.createElement('p'); note.textContent = '演示未能运行：' + error.message; document.body.append(note); }\n</script>`).join('\n');
await writeFile(new URL('demo/index.html', root), template.replace('<!-- DIGEST_SCRIPTS -->', () => inline));
console.log('Built dist/treehole-digest.user.js and standalone demo/index.html');
