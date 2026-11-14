import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((v) => {
  const [k, ...rest] = v.split('=');
  return [k.replace(/^--/, ''), rest.join('=')];
}));
const version = args.version;
const bundle = args.bundle ?? 'app/src-tauri/target/release/bundle';
const out = args.out ?? '.mirror-staging';
const baseUrl = (args['base-url'] ?? 'https://huohandu.cn/handpulse').replace(/\/$/, '');
const notes = args.notes ?? `HandPulse v${version}`;

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error('usage: node scripts/create-mirror.mjs --version=0.9.17');
}

const nsis = path.join(bundle, 'nsis', `HandPulse_${version}_x64-setup.exe`);
const msi = path.join(bundle, 'msi', `HandPulse_${version}_x64_en-US.msi`);
for (const file of [nsis, `${nsis}.sig`, msi, `${msi}.sig`]) {
  if (!fs.existsSync(file)) throw new Error(`missing ${file}`);
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const file of [nsis, `${nsis}.sig`, msi, `${msi}.sig`]) {
  fs.copyFileSync(file, path.join(out, path.basename(file)));
}

const signature = fs.readFileSync(`${nsis}.sig`).toString('base64');
const latest = {
  version,
  notes,
  pub_date: new Date().toISOString(),
  platforms: {
    'windows-x86_64': {
      signature,
      url: `${baseUrl}/HandPulse_${version}_x64-setup.exe`
    }
  }
};
fs.writeFileSync(path.join(out, 'latest.json'), JSON.stringify(latest, null, 2) + '\n');

const esc = (s) => String(s)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>HandPulse 下载</title><style>
body{margin:0;background:#08090b;color:#e9edf3;font-family:Inter,system-ui,sans-serif;line-height:1.6}
.wrap{max-width:760px;margin:0 auto;padding:64px 24px}h1{font-size:42px;margin:0 0 8px}p{color:#9aa6b4}
.tag{display:inline-block;border:1px solid #2c3540;border-radius:999px;padding:3px 10px;color:#69b6ff;font-size:12px}
.card{margin-top:28px;border:1px solid #252c35;border-radius:10px;background:#0e1115;padding:18px 20px}
a{color:#69b6ff}code{color:#c7d2df}.row{display:flex;justify-content:space-between;gap:16px;padding:10px 0;border-bottom:1px solid #1b2027}
.row:last-child{border:0}.muted{color:#6f7b88;font-size:12px}pre{white-space:pre-wrap;background:#0a0d11;border:1px solid #1b2027;border-radius:8px;padding:14px;color:#9aa6b4;font-size:13px}
</style></head><body><div class="wrap"><span class="tag">最新版本</span><h1>HandPulse</h1>
<p>Windows 本地键盘、鼠标、手柄使用分析工具。</p>
<div class="card">
<div class="row"><b>版本</b><code>v${esc(version)}</code></div>
<div class="row"><span>NSIS 安装包</span><a href="${baseUrl}/HandPulse_${version}_x64-setup.exe">下载 .exe</a></div>
<div class="row"><span>MSI 安装包</span><a href="${baseUrl}/HandPulse_${version}_x64_en-US.msi">下载 .msi</a></div>
<div class="row"><span>更新日志</span><a href="${baseUrl}/CHANGELOG.md">CHANGELOG.md</a></div>
</div><h2 style="margin-top:32px;font-size:18px">更新日志</h2><pre>${esc(notes)}</pre>
<p class="muted">服务器只保留最新安装包和更新日志；旧版本请从 GitHub Releases 获取。</p>
</div></body></html>`;
fs.writeFileSync(path.join(out, 'index.html'), html);

const changelogPath = args.changelog ?? 'CHANGELOG.md';
let changelog = fs.existsSync(changelogPath) ? fs.readFileSync(changelogPath, 'utf8') : '# HandPulse 更新日志\n';
if (!changelog.includes(`## v${version}`)) {
  const block = `\n## v${version}\n\n${notes}\n`;
  const first = changelog.indexOf('\n## ');
  changelog = first >= 0
    ? changelog.slice(0, first) + block + changelog.slice(first)
    : changelog.trimEnd() + '\n' + block;
}
fs.writeFileSync(path.join(out, 'CHANGELOG.md'), changelog);

console.log(`mirror ${version} -> ${out}`);
