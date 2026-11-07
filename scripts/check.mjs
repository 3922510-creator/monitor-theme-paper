import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

// 1. 版本一致性核验
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const theme = JSON.parse(fs.readFileSync(path.join(root, 'theme.json'), 'utf8'));

if (pkg.version !== theme.version) {
  console.error(`Version mismatch: package.json (${pkg.version}) !== theme.json (${theme.version})`);
  process.exit(1);
}

// 2. 检查必要资产
const requiredFiles = ['src/index.html', 'theme.json', 'preview.png', 'LICENSE', 'README.md'];
for (const file of requiredFiles) {
  if (!fs.existsSync(path.join(root, file))) {
    console.error(`Missing required file: ${file}`);
    process.exit(1);
  }
}

// 3. 提取 src/index.html 中的 JS 脚本进行语法校验
const html = fs.readFileSync(path.join(root, 'src/index.html'), 'utf8');
const scriptMatches = [...html.matchAll(/<script[\s\S]*?>([\s\S]*?)<\/script>/gi)];

if (scriptMatches.length === 0) {
  console.error('No script tag found in src/index.html');
  process.exit(1);
}

let scriptIndex = 0;
for (const match of scriptMatches) {
  scriptIndex++;
  const scriptContent = match[1];
  try {
    new vm.Script(scriptContent, { filename: `src/index.html#script[${scriptIndex}]` });
  } catch (err) {
    console.error(`JS syntax error in script block #${scriptIndex}:`, err);
    process.exit(1);
  }
}

console.log(`[check] Passed: version v${pkg.version}, assets complete, JS syntax valid.`);
