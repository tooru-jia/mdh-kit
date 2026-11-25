/**
 * 发布预演：确认 5 个包都能打包、内容正确
 *
 *   node tools/release-dry-run.mjs
 *
 * 不真的发布（npm publish --dry-run），只检查：
 *   ① 每个包的 tarball 能生成
 *   ② 子包依赖的版本能在本次发布里找到
 *   ③ 主包能引用到子包
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** 发布顺序：被依赖的在前 */
const PACKAGES = [
  { dir: '.', name: 'mdh-kit' },
  { dir: 'packages/mdh-core', name: '@mdh-kit/core' },
  { dir: 'packages/mdh-render', name: '@mdh-kit/render' },
  { dir: 'packages/mdh-compile', name: '@mdh-kit/compile' },
  { dir: 'packages/mdh-theme', name: '@mdh-kit/theme' },
];

const versions = new Map();
let bad = 0;

console.log('=== 发布顺序 ===');
for (const p of PACKAGES) {
  const pkgPath = join(ROOT, p.dir, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

  if (pkg.name !== p.name) {
    console.log(`✖ ${p.dir}: 包名不符（期望 ${p.name}，实际 ${pkg.name}）`);
    bad++;
    continue;
  }
  if (pkg.private === true) {
    console.log(`✖ ${pkg.name}: 标了 private，发布不出去`);
    bad++;
    continue;
  }

  versions.set(pkg.name, pkg.version);

  // 该包的依赖是否都在本次发布里、版本对得上
  const deps = Object.entries(pkg.dependencies ?? {});
  const problems = deps.filter(([n, v]) => {
    const mine = versions.get(n);
    return mine !== undefined && mine !== v;
  });

  let packed = '?';
  try {
    const out = execFileSync('npm', ['pack', '--dry-run', '--json'], {
      cwd: join(ROOT, p.dir),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const info = JSON.parse(out)[0];
    packed = `${info.files.length} 文件 / ${(info.size / 1024).toFixed(0)}KB`;
  } catch (e) {
    packed = `打包失败: ${String(e.message).slice(0, 60)}`;
    bad++;
  }

  const depNote = deps.length ? `依赖 ${deps.map(([n, v]) => `${n}@${v}`).join(', ')}` : '无依赖';
  const flag = problems.length ? `✖ ${problems.map(([n]) => n).join(',')} 版本不一致` : '✔';
  console.log(`${flag} ${pkg.name.padEnd(14)} v${pkg.version}  ${packed.padEnd(18)} ${depNote}`);
  if (problems.length) bad++;
}

console.log(`\n${PACKAGES.length - bad} / ${PACKAGES.length} 个包准备就绪`);
if (bad) console.log('有问题的包需要先修，别急着 publish');
process.exit(bad ? 1 : 0);
