/**
 * ============================================================================
 *  配置/样式校验脚本（scripts/validate-config.mjs）
 * ============================================================================
 *  在「无微信开发者工具」的环境下，用脚本兜住几类可静态验证的问题：
 *
 *    1. 所有 `.json` 配置文件语法合法（能被 JSON.parse 解析）。
 *    2. `theme.json` 仅用于**窗口配置**（`@变量名` 引用）：
 *         - light / dark 键集合一致；
 *         - 每个键都被某个 `.json` 里的 `@键` 引用（禁止把 CSS 变量塞进 theme.json）；
 *         - 每个 `@键` 引用都在 theme.json 中有定义。
 *    3. `app.wxss` 定义了 `core/themeTokens.ts` 声明的**全部颜色变量**：
 *         - 浅色（`page {}`）与深色（`@media (prefers-color-scheme: dark) { page {} }`）**两套都要齐**，
 *           且深色块**只**重定义颜色变量（键集合 = 颜色变量集合）。
 *    4. **孤儿变量防线**：全部 `.wxss` 中出现的 `var(--x)` 引用，`--x` 必须在 `app.wxss` 中定义
 *       （防止再次出现「引用了不存在/未注入的变量」导致真机 UI 丢失）。
 *
 *  运行：`npm run validate`
 * ============================================================================
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, extname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

/** 需要跳过的目录。 */
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git']);
/** 需要跳过的文件（体积大且非业务配置）。 */
const SKIP_FILES = new Set(['package-lock.json']);

/** 递归收集指定扩展名的文件。 */
function collectFiles(dir, ext, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) {
      continue;
    }
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      collectFiles(full, ext, out);
    } else if (extname(name) === ext && !SKIP_FILES.has(name)) {
      out.push(full);
    }
  }
  return out;
}

/** 去除 CSS 注释（避免注释里的示例变量名干扰扫描）。 */
function stripCssComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** 提取从 `startIdx` 起第一个 `{...}` 配对块的内部内容。 */
function extractBraceBlock(source, startIdx) {
  const open = source.indexOf('{', startIdx);
  if (open < 0) {
    return '';
  }
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(open + 1, i);
      }
    }
  }
  return source.slice(open + 1);
}

/** 收集 CSS 中「定义」的自定义属性名（`--x:`）。 */
function collectDefinedVars(css) {
  const set = new Set();
  const re = /(--[A-Za-z0-9-]+)\s*:/g;
  let m;
  while ((m = re.exec(css)) !== null) {
    set.add(m[1]);
  }
  return set;
}

/** 收集 CSS 中「引用」的自定义属性名（`var(--x`）。 */
function collectUsedVars(css) {
  const set = new Set();
  const re = /var\(\s*(--[A-Za-z0-9-]+)/g;
  let m;
  while ((m = re.exec(css)) !== null) {
    set.add(m[1]);
  }
  return set;
}

let failures = 0;
const fail = (msg) => {
  failures += 1;
  console.error(`✗ ${msg}`);
};

// ---------------------------------------------------------------------------
// 1. 所有 JSON 合法。
// ---------------------------------------------------------------------------
const jsonFiles = collectFiles(root, '.json');
for (const file of jsonFiles) {
  try {
    JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    fail(`JSON 非法：${file}\n  ${err.message}`);
  }
}
console.log(`[validate] 校验 JSON 文件 ${jsonFiles.length} 个。`);

// ---------------------------------------------------------------------------
// 2. theme.json（仅窗口配置用途）。
// ---------------------------------------------------------------------------
const theme = JSON.parse(readFileSync(join(root, 'theme.json'), 'utf8'));
if (!theme.light || !theme.dark) {
  fail('theme.json 缺少 light 或 dark 段。');
} else {
  const lightKeys = new Set(Object.keys(theme.light));
  const darkKeys = new Set(Object.keys(theme.dark));

  const onlyLight = [...lightKeys].filter((k) => !darkKeys.has(k));
  const onlyDark = [...darkKeys].filter((k) => !lightKeys.has(k));
  if (onlyLight.length || onlyDark.length) {
    fail(
      `theme.json light/dark 键集合不一致。light 独有：[${onlyLight.join(', ')}]；dark 独有：[${onlyDark.join(', ')}]`,
    );
  } else {
    console.log(`[validate] theme.json light/dark 键集合一致（${lightKeys.size} 个键）。`);
  }

  // 收集所有 JSON 配置里的 `@变量名` 引用。
  const referenced = new Set();
  for (const file of jsonFiles) {
    const text = readFileSync(file, 'utf8');
    const re = /"@([A-Za-z0-9_-]+)"/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      referenced.add(m[1]);
    }
  }

  // 每个 theme.json 键都必须被 JSON 配置引用（否则说明它不该待在 theme.json）。
  const unusedKeys = [...lightKeys].filter((k) => !referenced.has(k));
  if (unusedKeys.length) {
    fail(
      `theme.json 存在未被任何 JSON 配置（@键）引用的键：${unusedKeys.join(', ')}。` +
        `theme.json 只能用于窗口配置；颜色令牌请放到 app.wxss。`,
    );
  }

  // 每个 @引用 必须在 theme.json 中有定义。
  const missingTheme = [...referenced].filter((k) => !lightKeys.has(k) || !darkKeys.has(k));
  if (missingTheme.length) {
    fail(`JSON 配置引用了 theme.json 中不存在的变量：${missingTheme.join(', ')}`);
  }

  if (!unusedKeys.length && !missingTheme.length) {
    console.log(
      `[validate] theme.json 仅含被 @ 引用的窗口配置键（${[...lightKeys].join(', ')}）。`,
    );
  }
}

// ---------------------------------------------------------------------------
// 3. app.wxss 必须定义 themeTokens 声明的全部颜色变量（浅色 + 深色两套）。
// ---------------------------------------------------------------------------
const tokensSrc = readFileSync(join(root, 'core', 'themeTokens.ts'), 'utf8');
const requiredColorVars = [
  ...new Set((tokensSrc.match(/'(--[A-Za-z0-9-]+)'/g) || []).map((m) => m.slice(1, -1))),
];
const requiredSet = new Set(requiredColorVars);

const appWxss = stripCssComments(readFileSync(join(root, 'app.wxss'), 'utf8'));
const mediaIdx = appWxss.search(/@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)/);
const baseCss = mediaIdx >= 0 ? appWxss.slice(0, mediaIdx) : appWxss;
const darkCss = mediaIdx >= 0 ? extractBraceBlock(appWxss, mediaIdx) : '';

const baseVars = collectDefinedVars(baseCss);
const darkVars = collectDefinedVars(darkCss);

const baseMissing = requiredColorVars.filter((v) => !baseVars.has(v));
if (baseMissing.length) {
  fail(`app.wxss 的 page{} 缺少颜色变量定义：${baseMissing.join(', ')}`);
}

if (mediaIdx < 0) {
  fail('app.wxss 缺少 `@media (prefers-color-scheme: dark)` 深色颜色块。');
} else {
  const darkMissing = requiredColorVars.filter((v) => !darkVars.has(v));
  const darkExtra = [...darkVars].filter((v) => !requiredSet.has(v));
  if (darkMissing.length) {
    fail(`app.wxss 深色块缺少颜色变量定义：${darkMissing.join(', ')}`);
  }
  if (darkExtra.length) {
    fail(`app.wxss 深色块定义了非颜色（未在 themeTokens 声明）的变量：${darkExtra.join(', ')}`);
  }
}

if (!baseMissing.length && mediaIdx >= 0) {
  console.log(
    `[validate] app.wxss 已在浅色/深色两处定义全部 ${requiredColorVars.length} 个颜色变量。`,
  );
}

// ---------------------------------------------------------------------------
// 4. 孤儿变量防线：所有 .wxss 里 `var(--x)` 的 --x 必须在 app.wxss 中有定义。
// ---------------------------------------------------------------------------
const appDefinedVars = new Set([...baseVars, ...darkVars]);
const wxssFiles = collectFiles(root, '.wxss');
const orphans = new Set();
for (const file of wxssFiles) {
  const css = stripCssComments(readFileSync(file, 'utf8'));
  for (const v of collectUsedVars(css)) {
    if (!appDefinedVars.has(v)) {
      orphans.add(`${v}  (首次出现于 ${file.replace(root + '/', '')})`);
    }
  }
}
if (orphans.size) {
  fail(`以下 var(--x) 变量被使用但未在 app.wxss 中定义：\n  ${[...orphans].join('\n  ')}`);
} else {
  console.log(`[validate] 全部 ${wxssFiles.length} 个 .wxss 的 var(--*) 引用均已定义（无孤儿变量）。`);
}

if (failures > 0) {
  console.error(`\n[validate] 校验失败：共 ${failures} 处问题。`);
  process.exit(1);
}
console.log('\n[validate] 全部通过 ✓');
