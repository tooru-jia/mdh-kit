/**
 * 四档体积对照（用真实中文文档）
 *
 *   node tools/check-sizes.mjs
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { toBundle } from '../packages/mdh-export/src/index.ts';

/**
 * 项目根 mdh-kit 与样例目录
 *
 * 本文件在 mdh-kit/tools/ 下：
 *   '..'      → mdh-kit
 *   '../..'   → mdj_project
 *   '../../..'→ Workspace
 */
const KIT = resolve(import.meta.dirname, '..');
const PROJECT = resolve(KIT, '..');

const ENGINE = 'file://' + resolve(KIT, 'dist/mdh.browser.js');

const samples = [
  ['纯文字文档', resolve(PROJECT, 'mdjSample-1-commandline.mdj')],
  ['功能全测（含图表）', resolve(PROJECT, 'mdh/examples/test-features.mdh')],
];

for (const [name, path] of samples) {
  const src = readFileSync(path, 'utf8');
  console.log(`\n=== ${name} ===`);
  console.log('档   总大小     主文件     附加文件');
  for (const tier of ['A', 'B', 'C', 'D']) {
    const r = await toBundle(src, {
      tier,
      ...(tier === 'B' ? { engineUrl: ENGINE } : {}),
    });
    const keys = Object.keys(r.files);
    const total = Object.values(r.files).reduce((a, b) => a + b.length, 0);
    const main = r.files[r.entry].length;
    const extra = keys.filter((k) => k !== r.entry);
    console.log(
      `${tier}    ${(total / 1024).toFixed(0).padStart(6)}KB  ${(main / 1024).toFixed(0).padStart(6)}KB    ${extra.length ? extra.map((k) => `${k} ${(r.files[k].length / 1024).toFixed(0)}KB`).join(', ') : '—'}`,
    );
  }
}
