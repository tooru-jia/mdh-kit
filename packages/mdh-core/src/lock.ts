/**
 * 文档锁：识别发布器产出的「只读」文档
 *
 * ── 锁是什么 ──
 * 发布器产出的 .mdh 里有两样东西：
 *
 *   ===
 *   locked = true          ← ① 元信息里的标记
 *   ===
 *
 *   // -----BEGIN MDH SIGNATURE-----   ← ② 末尾的签名注释块
 *   // signer: acme-corp
 *   // signature: MEUCIQDx...
 *   // -----END MDH SIGNATURE-----
 *
 * **两样都有才算「锁上」**。缺任一样都视为无锁（可编辑）。
 *
 * ── 为什么缺一样就放行 ──
 * 这是「事后保护」，不是「防破解」：
 *   · 用户删掉签名 → 看起来就是无锁文件，允许编辑（正确行为）
 *   · 用户删掉 locked → 同理
 * 我们不试图防住「把锁整个删掉」—— 纯文本删完就和普通文件一样，
 * 技术上无法分辨。要防那个只能加密。
 *
 * ── 编辑即解锁 ──
 * 用户开始编辑时，`stripLock()` 会把 locked 与签名注释一起删掉。
 * 改过的文件就不再是原版，这是有意的。
 *
 * ── kit 不懂签名算法 ──
 * 只识别「有没有这一段」，不做验签。验签是发布器与阅读器之间的事，
 * 或者将来由外部工具做。kit 的职责到「有锁就不给编辑」为止。
 */

/** 签名注释块的起止标记 */
export const SIGNATURE_BEGIN = '-----BEGIN MDH SIGNATURE-----';
export const SIGNATURE_END = '-----END MDH SIGNATURE-----';

/** 锁的判定结果 */
export interface LockState {
  /** 是否锁定（locked=true 且存在签名块） */
  locked: boolean;
  /** 元信息里是否有 locked=true */
  hasLockFlag: boolean;
  /** 是否有签名注释块 */
  hasSignature: boolean;
}

/**
 * 判断文档是否被锁
 *
 * @param source 原始 mdh 源码
 * @param meta   parse() 返回的元信息（可选，省一次重复解析）
 */
export function detectLock(
  source: string,
  meta?: Record<string, string>,
): LockState {
  const hasLockFlag = isLockedFlag(meta?.['locked'] ?? readMetaValue(source, 'locked'));
  const hasSignature = hasSignatureBlock(source);
  return {
    locked: hasLockFlag && hasSignature,
    hasLockFlag,
    hasSignature,
  };
}

/** locked 的取值判定：true / yes / 1 都算（大小写不敏感） */
function isLockedFlag(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().replace(/^["']|["']$/g, '').toLowerCase();
  return v === 'true' || v === 'yes' || v === '1';
}

/** 从源码里直接读元信息字段（没有 parse 结果时用） */
function readMetaValue(source: string, key: string): string | undefined {
  const re = new RegExp(`^\\s*${key}\\s*=\\s*(.+)$`, 'm');
  return source.match(re)?.[1];
}

/** 是否存在签名注释块（起止标记都在就算） */
export function hasSignatureBlock(source: string): boolean {
  return source.includes(SIGNATURE_BEGIN) && source.includes(SIGNATURE_END);
}

/**
 * 剥掉锁：删除元信息里的 locked 行 + 整个签名注释块
 *
 * 用户开始编辑时调用 —— 改过的文件不再是原版。
 *
 * @returns 清理后的源码
 */
export function stripLock(source: string): string {
  const lines = source.split('\n');
  const out: string[] = [];
  let inSignature = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // 签名块：整段丢掉
    if (!inSignature && trimmed.includes(SIGNATURE_BEGIN)) {
      inSignature = true;
      continue;
    }
    if (inSignature) {
      if (trimmed.includes(SIGNATURE_END)) inSignature = false;
      continue;
    }

    // locked 元信息行：丢掉
    if (/^\s*locked\s*=/.test(line)) continue;

    out.push(line);
  }

  // 清理可能留下的尾部空行（签名块占掉了最后几行）
  while (out.length > 0 && out[out.length - 1].trim() === '') out.pop();

  return out.join('\n') + '\n';
}
