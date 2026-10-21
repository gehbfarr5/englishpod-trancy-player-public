/**
 * ============================================================================
 *  课程数据解析层（core/lessonModel.ts —— 纯 TypeScript，零平台依赖）
 * ============================================================================
 *  职责：把来自云端的「未知结构 JSON」严格解析为 `core/types.ts` 中的强类型对象。
 *
 *  设计原则（针对源项目的既有缺陷做的加固）：
 *   1. **兼容双键名**：索引用 `lesson_id`，详情用 `LessonId`。解析器两者都接受，
 *      绝不因为键名不一致而静默回退成默认值。
 *   2. **缺字段即报错**：核心字段缺失/类型错误时抛出 `LessonParseError`，
 *      让问题在数据边界暴露，而不是悄悄产出一堆 0 / 空串污染下游。
 *   3. **纯函数**：不读写任何全局状态、不触碰 `wx.*`，便于单测与多端复用。
 * ============================================================================
 */

import {
  AudioPaths,
  LessonDetail,
  LessonIndexItem,
  Segment,
  VocabEntry,
  WordTiming,
} from './types';

/** 课程数据解析错误。抛出即代表数据契约被破坏，需人工介入。 */
export class LessonParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LessonParseError';
    // 兼容 ES5 目标下的原型链（当前 target 为 ES2020，属防御性写法）。
    Object.setPrototypeOf(this, LessonParseError.prototype);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireObject(value: unknown, ctx: string): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new LessonParseError(`${ctx}: 期望一个对象，实际类型为 ${value === null ? 'null' : typeof value}`);
  }
  return value;
}

/**
 * 在一组候选键名中取出第一个「存在且非 null/undefined」的值。
 * 用于兼容 snake_case / camelCase / 大小写差异。
 */
function pickPresent(
  obj: Record<string, unknown>,
  keys: readonly string[],
  ctx: string,
): { key: string; value: unknown } {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const value = obj[key];
      if (value !== undefined && value !== null) {
        return { key, value };
      }
    }
  }
  throw new LessonParseError(`${ctx}: 缺少必填字段（尝试过的键名：${keys.join(' / ')}）`);
}

/** 取必填非空字符串。 */
function requireString(obj: Record<string, unknown>, keys: readonly string[], ctx: string): string {
  const { key, value } = pickPresent(obj, keys, ctx);
  if (typeof value !== 'string' || value.length === 0) {
    throw new LessonParseError(`${ctx}: 字段 "${key}" 期望非空字符串，实际为 ${JSON.stringify(value)}`);
  }
  return value;
}

/** 取必填有限数值（不接受 NaN / Infinity / 数字字符串）。 */
function requireNumber(obj: Record<string, unknown>, keys: readonly string[], ctx: string): number {
  const { key, value } = pickPresent(obj, keys, ctx);
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new LessonParseError(`${ctx}: 字段 "${key}" 期望有限数值，实际为 ${JSON.stringify(value)}`);
  }
  return value;
}

/** 取可选字符串，缺失或类型不符时返回默认值。 */
function optionalString(
  obj: Record<string, unknown>,
  keys: readonly string[],
  fallback: string,
): string {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string') {
      return value;
    }
  }
  return fallback;
}

/** 取可选有限数值，缺失或类型不符时返回默认值。 */
function optionalNumber(
  obj: Record<string, unknown>,
  keys: readonly string[],
  fallback: number,
): number {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }
  return fallback;
}

/** 取可选布尔值（同时兼容 snake_case 与 camelCase 键名）。 */
function optionalBoolean(
  obj: Record<string, unknown>,
  keys: readonly string[],
  fallback: boolean,
): boolean {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'boolean') {
      return value;
    }
  }
  return fallback;
}

/** 把可空字符串规整为 `string | null`（空串视为 null）。 */
function nullableString(obj: Record<string, unknown>, key: string): string | null {
  const value = obj[key];
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  return null;
}

/** 解析音频路径集合。缺省时三个字段均为 null。 */
function parseAudioPaths(raw: unknown, ctx: string): AudioPaths {
  if (raw === undefined || raw === null) {
    return { dg: null, pb: null, rv: null };
  }
  const obj = requireObject(raw, ctx);
  return {
    dg: nullableString(obj, 'dg'),
    pb: nullableString(obj, 'pb'),
    rv: nullableString(obj, 'rv'),
  };
}

/** 解析单个词级时间戳。 */
function parseWordTiming(raw: unknown, ctx: string): WordTiming {
  const obj = requireObject(raw, ctx);
  return {
    word: requireString(obj, ['word'], ctx),
    start: requireNumber(obj, ['start'], ctx),
    end: requireNumber(obj, ['end'], ctx),
  };
}

/** 解析单个片段。 */
function parseSegment(raw: unknown, ctx: string): Segment {
  const obj = requireObject(raw, ctx);
  const rawWords = obj.words;
  const words = Array.isArray(rawWords)
    ? rawWords.map((w, i) => parseWordTiming(w, `${ctx}.words[${i}]`))
    : [];

  return {
    id: Math.trunc(requireNumber(obj, ['id'], ctx)),
    speaker: optionalString(obj, ['speaker'], ''),
    text: optionalString(obj, ['text'], ''),
    isSection: optionalBoolean(obj, ['is_section', 'isSection'], false),
    inDialogueBlock: optionalBoolean(obj, ['in_dialogue_block', 'inDialogueBlock'], false),
    start: requireNumber(obj, ['start'], ctx),
    end: requireNumber(obj, ['end'], ctx),
    words,
  };
}

/** 解析单个词汇条目。 */
function parseVocabEntry(raw: unknown, ctx: string): VocabEntry {
  const obj = requireObject(raw, ctx);
  return {
    type: optionalString(obj, ['type'], 'key'),
    word: requireString(obj, ['word'], ctx),
    pos: optionalString(obj, ['pos'], ''),
    definition: optionalString(obj, ['definition'], ''),
  };
}

/**
 * 解析课程库索引项。
 *
 * 兼容键名：`lesson_id`（源数据索引实际使用的键）与 `LessonId`。
 * 缺 `lesson_id` / `code` / `lesson_number` 等核心字段时抛错。
 */
export function parseLessonIndexItem(raw: unknown): LessonIndexItem {
  const ctx = 'LessonIndexItem';
  const obj = requireObject(raw, ctx);
  return {
    lessonNumber: Math.trunc(requireNumber(obj, ['lesson_number', 'lessonNumber'], ctx)),
    lessonId: requireString(obj, ['lesson_id', 'LessonId'], ctx),
    code: requireString(obj, ['code'], ctx),
    level: optionalString(obj, ['level'], ''),
    title: optionalString(obj, ['title'], ''),
    dgCount: Math.trunc(optionalNumber(obj, ['dg_count', 'dgCount'], 0)),
    pbCount: Math.trunc(optionalNumber(obj, ['pb_count', 'pbCount'], 0)),
    vocabCount: Math.trunc(optionalNumber(obj, ['vocab_count', 'vocabCount'], 0)),
    audio: parseAudioPaths(obj.audio, `${ctx}.audio`),
  };
}

/**
 * 解析课程库索引数组。
 *
 * @param raw 云端返回的索引数组（或包含 `items` 字段的对象）。
 */
export function parseLessonIndex(raw: unknown): LessonIndexItem[] {
  let list: unknown = raw;
  if (isPlainObject(raw)) {
    list = raw.items;
  }
  if (!Array.isArray(list)) {
    throw new LessonParseError('LessonIndex: 期望数组，或包含 items 数组的对象');
  }
  return list.map((item, i) => parseLessonIndexItemWithIndex(item, i));
}

/** 在索引解析时携带下标，便于定位出错条目。 */
function parseLessonIndexItemWithIndex(raw: unknown, index: number): LessonIndexItem {
  try {
    return parseLessonIndexItem(raw);
  } catch (err) {
    if (err instanceof LessonParseError) {
      throw new LessonParseError(`LessonIndex[${index}]: ${err.message}`);
    }
    throw err;
  }
}

/**
 * 解析单课详情。
 *
 * 兼容键名：`LessonId`（源数据详情实际使用的键）与 `lesson_id`。
 * `tracks` 必须为对象，但内部 `dg` / `pb` 允许缺省（按空数组处理）。
 */
export function parseLessonDetail(raw: unknown): LessonDetail {
  const ctx = 'LessonDetail';
  const obj = requireObject(raw, ctx);

  const tracksObj = requireObject(obj.tracks, `${ctx}.tracks`);
  const rawDg = Array.isArray(tracksObj.dg) ? tracksObj.dg : [];
  const rawPb = Array.isArray(tracksObj.pb) ? tracksObj.pb : [];
  const rawVocab = Array.isArray(obj.vocabulary) ? obj.vocabulary : [];

  return {
    lessonNumber: Math.trunc(requireNumber(obj, ['lesson_number', 'lessonNumber'], ctx)),
    lessonId: requireString(obj, ['LessonId', 'lesson_id'], ctx),
    code: requireString(obj, ['code'], ctx),
    level: optionalString(obj, ['level'], ''),
    title: optionalString(obj, ['title'], ''),
    rawTitle: optionalString(obj, ['raw_title', 'rawTitle'], ''),
    audio: parseAudioPaths(obj.audio, `${ctx}.audio`),
    vocabulary: rawVocab.map((v, i) => parseVocabEntry(v, `${ctx}.vocabulary[${i}]`)),
    tracks: {
      dg: rawDg.map((s, i) => parseSegment(s, `${ctx}.tracks.dg[${i}]`)),
      pb: rawPb.map((s, i) => parseSegment(s, `${ctx}.tracks.pb[${i}]`)),
    },
  };
}
