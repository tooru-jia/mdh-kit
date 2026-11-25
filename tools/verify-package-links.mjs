/**
 * 校验「文档里指向的相对链接」在 npm 包里是否真的存在
 *
 *   node tools/verify-package-links.mjs
 *
 * ── 为什么需要它 ──
 * README 说「ID 规范见 docs/ID-SPEC.md」，但 files 字段没包含 docs/，
 * 用户 npm install 之后点链接就是 404。这类错误在本地开发时看不出来
 * —— 文件就在磁盘上，只有打完包才缺。
 *
 * 所以判据不是「磁盘上有没有」，而是「npm 包里有没有」。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

/** 会发布出去的文档 */
const DOCS = [
  'README.md',
  'NAMING.md',
  'VERIFICATION.md',
  'docs/AST-SPEC.md',
  'docs/CSS-CLASSES.md',
  'docs/ID-SPEC.md',
  'docs/INTEGRATION.md',
  'docs/SYNTAX-INTRODUCTION.md',
  'conformance/README.md',
];

/** 取 npm 包内的文件清单 */
function packedFiles() {
  const out = execFileSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  const data = JSON.parse(out);
  return new Set((data[0]?.files ?? []).map((f) => f.path));
}

/** 从 markdown 里抽出相对链接（排除 http、锚点、行内代码里的示例） */
function relativeLinks(md) {
  // 先把行内代码和代码块里的内容挖掉 —— 那里面的 `](url)` 是语法示例，不是链接
  const stripped = md
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`\n]*`/g, '');

  const links = new Set();
  for (const m of stripped.matchAll(/\]\(([^)\s]+)\)/g)) {
    const link = m[1];
    if (/^[a-z]+:/i.test(link)) continue; // http: / https: / mailto:
    if (link.startsWith('#')) continue;
    links.add(link.split('#')[0]);
  }
  return [...links];
}

const packed = packedFiles();
let bad = 0;
let checked = 0;

for (const doc of DOCS) {
  let md;
  try {
    md = readFileSync(join(ROOT, doc), 'utf8');
  } catch {
    console.log(`✖ ${doc} 本身不在仓库里`);
    bad++;
    continue;
  }
  if (!packed.has(doc)) {
    console.log(`✖ ${doc} 没打进 npm 包`);
    bad++;
  }

  for (const link of relativeLinks(md)) {
    const target = join(dirname(doc), link).replace(/\/$/, '');
    // 指向包外的（如 ../mdh-press/）不算错误，但提示一下
    if (target.startsWith('..')) {
      console.log(`  ⚠ ${doc} → ${link}（指向包外，用户装上后不可用）`);
      continue;
    }
    checked++;
    if (!packed.has(target) && ![...packed].some((p) => p.startsWith(target + '/'))) {
      console.log(`✖ ${doc} → ${link}：不在 npm 包里`);
      bad++;
    }
  }
}

console.log(
  `\n检查 ${checked} 个包内链接，${bad === 0 ? '全部有效' : `${bad} 个有问题`}`,
);
process.exit(bad ? 1 : 0);
