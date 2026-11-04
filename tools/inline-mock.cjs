/* 交付前把 <script src="mock-gen.js"></script> 内联成单文件。
 * 用法: node tools/inline-mock.cjs design-demos/dir-1.html [...]
 */
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const mockPath = path.join(root, 'design-demos', 'mock-gen.js');
const mock = fs.readFileSync(mockPath, 'utf8');

for (const rel of process.argv.slice(2)) {
  const file = path.resolve(root, rel);
  let html = fs.readFileSync(file, 'utf8');
  if (html.includes('window.HP = (function')) {
    console.log(`${rel}: already inlined`);
    continue;
  }
  const re = /<script\s+src=["'](?:\.\/)?mock-gen\.js["']\s*><\/script>/i;
  if (!re.test(html)) {
    console.error(`${rel}: no <script src="mock-gen.js"> found`);
    process.exitCode = 1;
    continue;
  }
  html = html.replace(re, '<script>\n' + mock + '\n</script>');
  fs.writeFileSync(file, html, 'utf8');
  console.log(`${rel}: inlined (${html.length} bytes)`);
}
