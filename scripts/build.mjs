import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

// 1. 语法与文件检查
execSync(`node "${path.join(__dirname, 'check.mjs')}"`, { stdio: 'inherit' });

// 2. 准备 dist 目录
const distDir = path.join(root, 'dist');
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// 3. 构建/同步产物 (保留格式完好直出)
const srcHtml = path.join(root, 'src', 'index.html');
const distHtml = path.join(distDir, 'index.html');
fs.copyFileSync(srcHtml, distHtml);
console.log(`[build] Synced src/index.html -> dist/index.html (${fs.statSync(distHtml).size} bytes)`);

// 4. 打包 theme.tar.gz
const tarFile = path.join(root, 'theme.tar.gz');
execSync(`tar -czf "${tarFile}" theme.json preview.png dist`, { cwd: root });

const hash = crypto.createHash('sha256').update(fs.readFileSync(tarFile)).digest('hex');
const size = fs.statSync(tarFile).size;
console.log(`[build] Packaged theme.tar.gz (${size} bytes, sha256: ${hash})`);
