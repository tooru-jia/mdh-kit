/**
 * 文档锁：识别与剥离
 *
 * 发布器产出的只读文档 = 元信息 `locked = true` + 末尾签名注释块。
 * 两样都有才算锁上；缺任一样放行（事后保护，不防破解）。
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { detectLock, stripLock, hasSignatureBlock } from '../src/lock.ts';

const SIG = [
  '// -----BEGIN MDH SIGNATURE-----',
  '// signer: acme-corp',
  '// signature: MEUCIQDx',
  '// -----END MDH SIGNATURE-----',
].join('\n');

const LOCKED_DOC = `===
title = 年度报告
locked = true
===

# 正文

内容一段。

${SIG}
`;

const PLAIN_DOC = `===
title = 普通文档
===

# 正文

内容一段。
`;

test('锁：locked + 签名 → 锁上', () => {
  const s = detectLock(LOCKED_DOC);
  assert.equal(s.locked, true);
  assert.equal(s.hasLockFlag, true);
  assert.equal(s.hasSignature, true);
});

test('锁：只有 locked 没签名 → 不锁（放行）', () => {
  const doc = LOCKED_DOC.replace(SIG, '');
  const s = detectLock(doc);
  assert.equal(s.hasLockFlag, true);
  assert.equal(s.hasSignature, false);
  assert.equal(s.locked, false, '缺签名视为无锁');
});

test('锁：只有签名没 locked → 不锁（放行）', () => {
  const doc = PLAIN_DOC + '\n' + SIG + '\n';
  const s = detectLock(doc);
  assert.equal(s.hasLockFlag, false);
  assert.equal(s.hasSignature, true);
  assert.equal(s.locked, false, '缺 locked 视为无锁');
});

test('锁：普通文档不锁', () => {
  const s = detectLock(PLAIN_DOC);
  assert.equal(s.locked, false);
});

test('锁：locked 取值兼容 true/yes/1/带引号', () => {
  for (const v of ['true', 'TRUE', 'yes', '1', '"true"']) {
    const doc = `===\nlocked = ${v}\n===\n\n正文\n\n${SIG}\n`;
    assert.equal(detectLock(doc).locked, true, `locked = ${v} 应识别为锁`);
  }
  for (const v of ['false', 'no', '0', '']) {
    const doc = `===\nlocked = ${v}\n===\n\n正文\n\n${SIG}\n`;
    assert.equal(detectLock(doc).locked, false, `locked = ${v} 不该锁`);
  }
});

test('锁：用 parse 的 meta 结果判定', () => {
  const s = detectLock(LOCKED_DOC, { title: '年度报告', locked: 'true' });
  assert.equal(s.locked, true);
});

test('剥离：删掉 locked 与整个签名块', () => {
  const out = stripLock(LOCKED_DOC);
  assert.ok(!out.includes('locked'), 'locked 应被删除');
  assert.ok(!out.includes('BEGIN MDH SIGNATURE'), '签名块应被删除');
  assert.ok(!out.includes('MEUCIQDx'), '签名内容应被删除');
  assert.ok(out.includes('# 正文'), '正文保留');
  assert.ok(out.includes('内容一段'), '内容保留');
  assert.ok(out.includes('title = 年度报告'), '其它元信息保留');
});

test('剥离：无锁文档原样保留', () => {
  const out = stripLock(PLAIN_DOC);
  assert.ok(out.includes('# 正文'));
  assert.ok(out.includes('title = 普通文档'));
});

test('剥离后再检测 → 不再锁定', () => {
  const out = stripLock(LOCKED_DOC);
  assert.equal(detectLock(out).locked, false);
});

test('签名块识别：起止标记缺一不可', () => {
  assert.equal(hasSignatureBlock(`x\n${SIG}\ny`), true);
  assert.equal(hasSignatureBlock('// -----BEGIN MDH SIGNATURE-----'), false);
  assert.equal(hasSignatureBlock('// -----END MDH SIGNATURE-----'), false);
});
