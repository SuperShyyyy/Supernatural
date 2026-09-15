/**
 * 打包：把构建产物 + 零依赖静态服务器 + 启动脚本组装成可分发的目录。
 *
 * 产物是纯前端应用（ES module），不能用 file:// 打开，所以必须自带一个最小服务器。
 */

import { cp, chmod, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'build/supernatural');

await rm(output, { recursive: true, force: true });
await mkdir(resolve(output, 'app'), { recursive: true });

await cp(resolve(root, 'dist'), resolve(output, 'app'), { recursive: true });
await cp(resolve(root, 'scripts/serve.mjs'), resolve(output, 'serve.mjs'));
await cp(resolve(root, 'scripts/start.sh'), resolve(output, 'start.sh'));
await cp(resolve(root, 'scripts/package/README.md'), resolve(output, 'README.md'));
await chmod(resolve(output, 'start.sh'), 0o755);

// eslint-disable-next-line no-console
console.log(`打包完成: ${output}`);
