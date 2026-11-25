/**
 * 未知语法行为验证
 *
 * 这里验的是「宽松解析」：认不得的东西不报错、不崩溃、不吞内容。
 * 对应 VERIFICATION.md「当前已知限制」里的「未知语法」一条。
 */
import { parse } from '../packages/mdh-core/src/index.ts';
import { render } from '../packages/mdh-render/src/index.ts';

const CASES = [
  ['未知块名', '***unknownblock\n内容\n***unknownblock-end', '内容照常显示'],
  ['未知块名带参数', '***xxx(1fr)\n甲\n***xxx-end', '不崩'],
  ['未知指令', '@unknown(值)\n\n正文', '正文渲染，@unknown 标失效引用'],
  ['未知 @ 函数', '正文 @unknownfn(参数) 结束', '不崩'],
  ['未闭合块', '***table\nhead: A\n- 1', '报 1 个错误，内容不丢'],
  ['乱写符号', '###@@@!!!***', '当文字'],
  ['超长未知块名', '***' + 'a'.repeat(200) + '\n内容\n***' + 'a'.repeat(200) + '-end', '不崩'],
  ['空文档', '', '不崩'],
  ['纯空白', '   \n\n\t\n', '不崩'],
  ['只有块标记', '***', '不崩'],
];

let failed = 0;

for (const [label, src, expect] of CASES) {
  let line = label.padEnd(16) + ' | ';
  try {
    const r = parse(src);
    const html = render(r.ast);
    const errs = (r.diagnostics || []).filter((d) => d.level === 'error');
    line += `诊断 ${(r.diagnostics || []).length} / 错误 ${errs.length} / HTML ${html.length} 字符`;
    // 基本断言：不能抛错、必须产出 HTML
    if (typeof html !== 'string' || html.length === 0) {
      line += '  ✖ 没产出 HTML';
      failed++;
    }
  } catch (e) {
    line += '  ✖ 抛错了：' + (e).message.slice(0, 50);
    failed++;
  }
  console.log(line + '   ← 预期：' + expect);
}

console.log(failed === 0 ? '\n✔ 全部未崩溃' : `\n✖ ${failed} 项异常`);
