/**
 * 生成器标识（Generator Stamp）
 *
 * ────────────────────────────────────────────────────────────────
 * 重要：这不是安全机制
 * ────────────────────────────────────────────────────────────────
 *
 * 本模块输出的所有信息都是**自我声明**，任何人手写一行 `<meta>` 就能伪造。
 * 它的用途只有三个：
 *
 *   1. 排错   —— 用户报问题时，能知道是哪一版生成的
 *   2. 兼容   —— 工具能判断该版本支持哪些语法
 *   3. 溯源线索 —— AI / 工具能知道「这份声称由谁生成」
 *
 * 它**不能**回答的问题：
 *
 *   ✗ 这份文档可不可信
 *   ✗ 内容有没有被篡改
 *   ✗ 是不是真的由 mdh 生成
 *
 * 需要验证来源时，只能用发布器的**签名**（密钥在可信方手里）。
 * 没有签名的情况下，任何标识都只是自我声明。
 *
 * → 字段命名刻意避开 verified / trusted / secure 这类词，
 *   避免使用者误以为是安全保证。
 */

/** 三层版本号（解析 / 渲染 / 挂载） */
export interface LayerVersions {
  /** 解析层：源码 → AST */
  parser: string;
  /** 渲染层：把 AST 画成页面 */
  renderer: string;
  /** 挂载层：运行时注入（公式、图表、交互） */
  runtime: string;
}

export interface GeneratorStamp {
  /** 工具链名，固定 'mdh-kit' */
  toolchain: string;
  /** 整体版本（取核心包版本） */
  version: string;
  /** 三层各自的版本 */
  layers: LayerVersions;
  /** 构建时间（ISO 8601，可选；构建时未传则为 undefined） */
  build?: string;
  /** 运行时环境：node / browser / unknown */
  env?: 'node' | 'browser' | 'unknown';
}

/**
 * 当前版本号
 *
 * 刻意写死在这里而不是读 package.json：
 *   - 浏览器包里读不到 package.json
 *   - 构建时注入（见 tools/build-browser.mjs）会覆盖它
 *
 * 升级版本时改这一处即可。
 */
export const MDH_VERSION = '1.0.0';

/** 构建时间占位：构建脚本会替换成真实时间 */
export const MDH_BUILD_TIME = '';

/**
 * 生成当前环境的标识
 *
 * @param overrides 构建时注入的覆盖值（版本 / 构建时间 / 环境）
 */
export function makeGeneratorStamp(overrides: Partial<GeneratorStamp> = {}): GeneratorStamp {
  const version = overrides.version ?? MDH_VERSION;
  const build = overrides.build ?? (MDH_BUILD_TIME || undefined);
  const env =
    overrides.env ??
    (typeof window !== 'undefined' ? 'browser' : typeof process !== 'undefined' ? 'node' : 'unknown');

  return {
    toolchain: 'mdh-kit',
    version,
    // 三层版本默认跟随整体版本。
    // 将来某层独立演进了（比如 renderer 单独发版），再在这里分开维护。
    layers: overrides.layers ?? {
      parser: version,
      renderer: version,
      runtime: version,
    },
    ...(build ? { build } : {}),
    env,
  };
}

/**
 * 渲染成 HTML `<meta>` 标签
 *
 *   <meta name="mdh-generator" content="mdh-kit/1.0.0">
 *   <meta name="mdh-layers"    content="parser=1.0.0;renderer=1.0.0;runtime=1.0.0">
 *   <meta name="mdh-build"     content="2026-11-22T14:30:00Z">   （可选）
 *   <meta name="mdh-env"       content="node">
 *
 * 只提供事实，不做任何「是否可信」的声明。
 *
 * 曾经加过一条 `mdh-stamp-note` 写明「这是自我声明、不是安全证明」，
 * 后来去掉了（作者 2026-11-22）：恶意方可以删掉它，留数据不留声明；
 * 用一段可伪造的话去保证另一段可伪造的话不可信，逻辑上站不住。
 *
 * 「这几个字段不代表可信」这件事写在模块开头的注释和对外文档里，
 * 由人读；机器侧的信任判断必须由 AI / 工具自己维护认可名单。
 */
export function generatorMetaTags(stamp: GeneratorStamp): string {
  const esc = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const layers = `parser=${stamp.layers.parser};renderer=${stamp.layers.renderer};runtime=${stamp.layers.runtime}`;
  const lines = [
    `<meta name="mdh-generator" content="${esc(`${stamp.toolchain}/${stamp.version}`)}">`,
    `<meta name="mdh-layers" content="${esc(layers)}">`,
  ];
  if (stamp.build) lines.push(`<meta name="mdh-build" content="${esc(stamp.build)}">`);
  if (stamp.env) lines.push(`<meta name="mdh-env" content="${esc(stamp.env)}">`);

  return lines.join('\n');
}

/**
 * 渲染成 JSON（供 `data-mdh-stamp` 属性或 API 返回）
 *
 * 结构预留了 publisher / signature 字段：发布器将来填充后，
 * 读取方可用 `signature` 是否存在判断「是否经过验签」。
 */
export function generatorStampJson(stamp: GeneratorStamp): string {
  return JSON.stringify({
    generator: stamp,
    // 发布器填充：{ name, keyId, signature, signedAt }
    publisher: null,
  });
}
