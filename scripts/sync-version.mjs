import fs from 'node:fs';

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+/.test(version)) {
  throw new Error('usage: node scripts/sync-version.mjs <x.y.z>');
}

const pkgPath = 'app/package.json';
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
pkg.version = version;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

const cargoPath = 'app/src-tauri/Cargo.toml';
let cargo = fs.readFileSync(cargoPath, 'utf8');
cargo = cargo.replace(/^version = ".*?"$/m, `version = "${version}"`);
fs.writeFileSync(cargoPath, cargo);

const confPath = 'app/src-tauri/tauri.conf.json';
const conf = JSON.parse(fs.readFileSync(confPath, 'utf8'));
conf.version = version;
fs.writeFileSync(confPath, JSON.stringify(conf, null, 2) + '\n');

console.log(`version -> ${version}`);
