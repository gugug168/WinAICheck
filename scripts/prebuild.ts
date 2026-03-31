/**
 * 构建脚本：创建 react-devtools-core stub 并构建 exe
 */
import { mkdirSync, writeFileSync } from 'fs';

// 创建 stub 替代 15MB 的 react-devtools-core
const stubDir = 'node_modules/react-devtools-core';
mkdirSync(stubDir, { recursive: true });
writeFileSync(`${stubDir}/index.js`, 'export function connectToDevTools() {}\nexport default { connectToDevTools };\n');
writeFileSync(`${stubDir}/package.json`, JSON.stringify({ type: 'module', main: 'index.js' }));
console.log('Created react-devtools-core stub');
