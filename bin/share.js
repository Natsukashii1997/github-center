// 导出分享页（#63）：npm run share -- [--data data] [--out data/share] [--as <账号名>]
// 本进程起临时网站取发现、涨星、收藏、设置四页，下载项目头像，写到 --out。不碰常驻的 5310，不发布。
// 发布：Claude 用 Artifact 工具更新 https://claude.ai/artifact/1iKdvvQhdqQn8hqoQEAqmL，
// 主页面 index.html，其余 5 个文件作附带文件（见 docs/share.md）。
import { parseArgs } from 'node:util';
import { join, resolve } from 'node:path';
import { takeShare } from '../src/share/index.js';

const { values } = parseArgs({ options: { data: { type: 'string', default: 'data' }, out: { type: 'string' }, as: { type: 'string' } } });
const out = resolve(values.out ?? join(values.data, 'share'));
const r = await takeShare({ dataDir: values.data, outDir: out, account: values.as });
console.log(`分享页 · ${r.label} → ${out}`);
for (const [f, n] of Object.entries(r.files)) console.log(`  ${f}  ${(n / 1024).toFixed(0)} KB`);
console.log(`头像 ${r.avatars[0]}/${r.avatars[1]}，安装指令 ${r.install[0]}/${r.install[1]}`);
if (r.avatars[0] < r.avatars[1]) console.log('有头像没下到：页面上那几个留灰底，可以稍后再跑一次');
