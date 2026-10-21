/**
 * ============================================================================
 *  字幕视图层（core/transcriptView.ts —— 纯 TypeScript，零平台依赖）
 * ============================================================================
 *  职责：把 `LessonDetail` 的原始片段，加工成**可直接渲染的字幕视图模型**：
 *    - 说话人分区 + 三类「舞台盒子」（📌 DIALOGUE · SCENE / 💡 EXAMPLES · IN ACTION /
 *      ✨ KEY PHRASE DRILL）；
 *    - 词节点（含 `isVocab` 标记，供视图层做**句级**词汇高亮）；
 *    - 说话人展示名映射（`M`→`MARCO` 等，对齐 iOS `_resolveSpeakerDisplayName`）；
 *    - Vocab 面板条目（含课内例句，支持点例句跳播）。
 *
 *  该模块的产物是**加载期一次性**渲染数据；播放中的高频更新只走
 *  `core/highlightCursor.ts` 的极小 payload，二者互不干扰。
 *
 *  分类规则对齐 Flutter `_computeStageGroups`。
 * ============================================================================
 */

import { AudioTrackKey, Segment, VocabEntry } from './types';

/** 舞台盒子类型：`dialogue`（对话/场景）｜`example`（用法示例）｜`phrase`（关键句型操练）。 */
export type StageKind = 'dialogue' | 'example' | 'phrase';

/** 舞台盒子元信息。 */
export interface StageGroupInfo {
  /** 盒子分组 ID（同一次连续盒子内相同）。 */
  boxGroupId: number;
  /** 盒子类型。 */
  kind: StageKind;
  /** 顶部徽章文案。 */
  badgeText: string;
  /** 副标题。 */
  subText: string;
  /** 是否本盒子首行。 */
  isFirstInBox: boolean;
  /** 是否本盒子末行。 */
  isLastInBox: boolean;
}

/** 渲染用词节点（精简：不含时间戳，时间轴由 core 侧持有）。 */
export interface TranscriptWordVM {
  /** 词面文本。 */
  text: string;
  /** 是否为课程词汇（用于词汇高亮）。 */
  isVocab: boolean;
}

/** 渲染用片段视图模型。 */
export interface TranscriptSegmentVM {
  /** 片段 ID。 */
  id: number;
  /** 说话人标记。 */
  speaker: string;
  /** 说话人**展示名**（`M`→`MARCO` 等，对齐 iOS）。 */
  speakerLabel: string;
  /** 展示文本。 */
  text: string;
  /** 是否章节标记。 */
  isSection: boolean;
  /** 起始时间（秒），用于点句跳播。 */
  start: number;
  /** 结束时间（秒）。 */
  end: number;
  /** 是否为主持人旁白（无舞台盒子）。 */
  isHost: boolean;
  /** 词节点列表。 */
  words: TranscriptWordVM[];
  /** 所属舞台盒子（无则 null）。 */
  stage: StageGroupInfo | null;
}

/** 词汇面板·课内例句。 */
export interface VocabExampleVM {
  /** 所在音轨。 */
  track: AudioTrackKey;
  /** 该音轨内的片段下标（用于跳播）。 */
  segIdx: number;
  /** 例句文本。 */
  text: string;
}

/** 词汇面板条目。 */
export interface VocabEntryVM {
  /** 在词汇表中的下标。 */
  index: number;
  /** 类型（`key` / `supplementary`）。 */
  type: string;
  /** 词 / 短语。 */
  word: string;
  /** 词性。 */
  pos: string;
  /** 释义。 */
  definition: string;
  /** 课内例句（最多若干条）。 */
  examples: VocabExampleVM[];
}

/** 主持人说话人标记集合（无舞台盒子）。 */
const HOST_SPEAKERS = new Set(['M', 'E', 'A']);

/**
 * 主持人展示名映射（对齐 iOS `_resolveSpeakerDisplayName`）。
 *
 * 仅在**主持人开放流**（无舞台盒子）时展开为全名；盒子里 `M` 也显示 `MARCO`，
 * 其余说话人统一大写。
 */
const HOST_FULL_NAMES: Record<string, string> = {
  M: 'MARCO',
  E: 'ERICA',
  C: 'CATHERINE',
  A: 'AMIRA',
  S: 'SARAH',
  P: 'PETER',
  'C,M': 'MARCO & CATHERINE',
  'M,C': 'MARCO & CATHERINE',
};

/**
 * 说话人展示名（对齐 iOS）：
 *   - 无舞台盒子（主持人开放流）：`M/E/C/A/S/P` 展开为全名，`C,M`/`M,C` 合并；
 *   - 有舞台盒子：`M` → `MARCO`，其余一律大写。
 */
function resolveSpeakerLabel(speaker: string, hasStage: boolean): string {
  const s = (speaker || '').trim();
  if (!s) {
    return '•';
  }
  if (!hasStage) {
    const full = HOST_FULL_NAMES[s];
    if (full) {
      return full;
    }
  } else if (s === 'M') {
    return 'MARCO';
  }
  return s.toUpperCase();
}

/**
 * 是否为「关键句型操练」段落（`✨ KEY PHRASE DRILL`）。
 *
 * ⚠️ 这是我们**主动超越 iOS** 新增的第三类舞台盒子（iOS 无此类）。判定规则依
 * `DESIGN.md` §2 第 43 行（该盒子承载 `Phrase 1/2/3` 与 section jingles），满足其一：
 *   1. **段标记文本**匹配 `Phrase 1/2/3`：`/^\s*phrase\s*[1-3]\b/i`；
 *   2. **旁白说话人**匹配 `Phrase 1/2/3`：`/^phrase\s*[1-3]\b/i`（如 speaker = `Phrase 1`）；
 *   3. **段标记文本**含关键句型/操练关键词：`/(key\s*phrase|phrase\s*drill)/i`。
 *
 * 说明：当前 1–30 课数据的 section 仅有 `DIALOGUE, x TIME`，尚无 `Phrase n`，
 * 故本规则**暂不触发**（前向兼容）；一经出现即归入该类盒子。后续需真机比对。
 */
function isPhraseDrillSegment(seg: Segment): boolean {
  const text = (seg.text || '').trim();
  const speaker = (seg.speaker || '').trim();
  if (/^\s*phrase\s*[1-3]\b/i.test(text)) {
    return true;
  }
  if (/^phrase\s*[1-3]\b/i.test(speaker)) {
    return true;
  }
  if (/(key\s*phrase|phrase\s*drill)/i.test(text)) {
    return true;
  }
  return false;
}

/**
 * 计算某音轨每个片段的舞台盒子归属。
 *
 * - `dg` 轨：整轨视为一个 `dialogue` 盒子；
 * - `pb` 轨：`is_section` / `in_dialogue_block` → dialogue；`example*` 说话人
 *   / `Voice: Example ...` 起的示例段 → example；其余（主持人旁白）→ null。
 */
export function computeStageGroups(
  segments: readonly Segment[],
  track: AudioTrackKey,
): Array<StageGroupInfo | null> {
  const n = segments.length;
  if (n === 0) {
    return [];
  }

  if (track === 'dg') {
    return segments.map((_, i) => ({
      boxGroupId: 0,
      kind: 'dialogue' as StageKind,
      badgeText: '🎭 FULL DIALOGUE TRACK',
      subText: 'Original Scene',
      isFirstInBox: i === 0,
      isLastInBox: i === n - 1,
    }));
  }

  const rawKind: Array<StageKind | null> = new Array(n).fill(null);
  const customBadge: string[] = new Array(n).fill('');

  let i = 0;
  while (i < n) {
    const s = segments[i];
    const spk = s.speaker.trim();
    const txt = s.text.trim();

    if (s.isSection || s.inDialogueBlock) {
      if (isPhraseDrillSegment(s)) {
        rawKind[i] = 'phrase';
        customBadge[i] = '✨ KEY PHRASE DRILL';
      } else {
        rawKind[i] = 'dialogue';
        if (s.isSection) {
          customBadge[i] = `📌 ${txt.toUpperCase()}`;
        }
      }
      i += 1;
      continue;
    }

    if (spk.toLowerCase().startsWith('example')) {
      rawKind[i] = 'example';
      customBadge[i] = '💡 EXAMPLES · IN ACTION';
      i += 1;
      continue;
    }

    if (spk === 'Voice' && txt.toLowerCase().startsWith('example')) {
      rawKind[i] = 'example';
      customBadge[i] = '💡 EXAMPLES · IN ACTION';
      if (
        i + 1 < n &&
        !segments[i + 1].isSection &&
        segments[i + 1].speaker !== 'M' &&
        segments[i + 1].speaker !== 'Voice'
      ) {
        rawKind[i + 1] = 'example';
        const firstSpk = segments[i + 1].speaker;
        if (i + 2 < n && !segments[i + 2].isSection) {
          const secSpk = segments[i + 2].speaker;
          const secTxt = segments[i + 2].text.trim();
          const isPairedTurn =
            (firstSpk === 'A' && secSpk === 'B') ||
            (firstSpk === 'C' && secSpk === 'D') ||
            (firstSpk === 'E' && secSpk === 'F') ||
            (firstSpk === 'B' && secSpk === 'C' && !secTxt.startsWith('Alright'));
          if (isPairedTurn) {
            rawKind[i + 2] = 'example';
            i += 3;
            continue;
          }
        }
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }

    i += 1;
  }

  const result: Array<StageGroupInfo | null> = new Array(n).fill(null);
  let currentBoxId = 0;
  for (let idx = 0; idx < n; idx += 1) {
    const k = rawKind[idx];
    if (k === null) {
      continue;
    }
    const isFirst = idx === 0 || rawKind[idx - 1] !== k;
    if (isFirst) {
      currentBoxId += 1;
    }
    const isLast = idx === n - 1 || rawKind[idx + 1] !== k;

    let badge = customBadge[idx];
    if (!badge) {
      if (k === 'dialogue') {
        badge = '📌 DIALOGUE · SCENE';
      } else if (k === 'phrase') {
        badge = '✨ KEY PHRASE DRILL';
      } else {
        badge = '💡 EXAMPLES · IN ACTION';
      }
    }
    const subText =
      k === 'dialogue'
        ? 'Scene Transcript'
        : k === 'phrase'
          ? 'Key Phrase Drill'
          : 'Usage Examples';

    result[idx] = {
      boxGroupId: currentBoxId,
      kind: k,
      badgeText: badge,
      subText,
      isFirstInBox: isFirst,
      isLastInBox: isLast,
    };
  }
  return result;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 词汇匹配器。 */
export interface VocabMatcher {
  /** 编译好的整词/整短语正则。若无词汇则为 null。 */
  regex: RegExp | null;
  /** 单个词（已归一化）是否命中单词课程词汇。 */
  hasToken(normalizedToken: string): boolean;
  /** 一段文本是否包含某个词汇短语（用于挑课内例句）。 */
  matchesText(text: string): boolean;
}

/** 归一化单个词：转小写、去除非字母数字/撇号、去首尾空白。 */
export function normalizeToken(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9']+/g, '')
    .trim();
}

/** 归一化整段文本：非字母数字统一成空格并压缩，首尾补空格（便于边界匹配）。 */
function normalizeText(text: string): string {
  const core = text
    .toLowerCase()
    .replace(/[^a-z0-9']+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return ` ${core} `;
}

/**
 * 由词汇表构建匹配器。
 * 对齐 iOS 黄金基线 `_compileVocabRegex`：
 * 严格基于课程真实词条整词/整短语做词界正则（`\b(?:phrase|word)\b`），
 * 长词/长短语优先匹配，彻底杜绝将短语拆开导致普通虚词（on/in/the/with）误高亮。
 */
export function buildVocabMatcher(vocabulary: readonly VocabEntry[]): VocabMatcher {
  const exactWordSet = new Set<string>();
  const phrases: string[] = [];
  const rawWords: string[] = [];

  for (const entry of vocabulary) {
    const raw = (entry.word || '').trim();
    if (!raw) {
      continue;
    }
    rawWords.push(raw);
    const norm = normalizeToken(raw);
    if (norm) {
      exactWordSet.add(norm);
    }
    const cleanPhrase = raw
      .toLowerCase()
      .split(/[^a-z0-9']+/)
      .filter((p) => p.length >= 2)
      .join(' ');
    if (cleanPhrase) {
      phrases.push(cleanPhrase);
    }
  }

  const uniqueWords = Array.from(new Set(rawWords.filter((w) => w.length >= 2))).sort(
    (a, b) => b.length - a.length,
  );

  let regex: RegExp | null = null;
  if (uniqueWords.length > 0) {
    const pattern = uniqueWords.map(escapeRegex).join('|');
    regex = new RegExp(`\\b(?:${pattern})\\b`, 'gi');
  }

  return {
    regex,
    hasToken(normalizedToken: string): boolean {
      return exactWordSet.has(normalizedToken);
    },
    matchesText(text: string): boolean {
      if (phrases.length === 0 || !text) {
        return false;
      }
      const norm = normalizeText(text);
      return phrases.some((p) => norm.indexOf(` ${p} `) >= 0);
    },
  };
}

/**
 * 构建某音轨的渲染用字幕视图模型。
 * 词汇高亮判定：基于句内正则匹配区间精准着色，只有出现在课程生词/短语内的词才高亮。
 */
export function toTranscriptSegments(
  segments: readonly Segment[],
  track: AudioTrackKey,
  matcher: VocabMatcher,
): TranscriptSegmentVM[] {
  const groups = computeStageGroups(segments, track);
  const regex = matcher.regex;

  return segments.map((seg, index) => {
    const stage = groups[index] ?? null;
    const sentenceText = seg.text || '';

    // 计算当前句子内所有生词/短语的字符起止区间 [start, end)
    const highlightRanges: Array<{ start: number; end: number }> = [];
    if (regex && sentenceText) {
      regex.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = regex.exec(sentenceText)) !== null) {
        highlightRanges.push({
          start: m.index,
          end: m.index + m[0].length,
        });
      }
    }

    let words: TranscriptWordVM[] = [];
    if (seg.words && seg.words.length > 0) {
      // 遍历原始分词，根据其在句子中的字符位置判断是否落在生词区间内
      let searchCursor = 0;
      words = seg.words.map((w) => {
        const wordText = w.word;
        const foundPos = sentenceText.indexOf(wordText, searchCursor);
        const wordStart = foundPos >= 0 ? foundPos : searchCursor;
        const wordEnd = wordStart + wordText.length;
        if (foundPos >= 0) {
          searchCursor = wordEnd;
        }

        const isVocab = highlightRanges.some(
          (range) => wordStart < range.end && wordEnd > range.start,
        );

        return {
          text: wordText,
          isVocab,
        };
      });
    } else if (sentenceText.trim()) {
      // 无词级分词时的文本分词兜底
      if (highlightRanges.length === 0) {
        words = sentenceText.trim().split(/\s+/).map((t) => ({ text: t, isVocab: false }));
      } else {
        let lastEnd = 0;
        for (const r of highlightRanges) {
          if (r.start > lastEnd) {
            const nonVocab = sentenceText.slice(lastEnd, r.start).trim();
            if (nonVocab) {
              for (const t of nonVocab.split(/\s+/)) {
                if (t) words.push({ text: t, isVocab: false });
              }
            }
          }
          const vocabText = sentenceText.slice(r.start, r.end).trim();
          if (vocabText) {
            for (const t of vocabText.split(/\s+/)) {
              if (t) words.push({ text: t, isVocab: true });
            }
          }
          lastEnd = r.end;
        }
        if (lastEnd < sentenceText.length) {
          const tail = sentenceText.slice(lastEnd).trim();
          if (tail) {
            for (const t of tail.split(/\s+/)) {
              if (t) words.push({ text: t, isVocab: false });
            }
          }
        }
      }
    }

    return {
      id: seg.id,
      speaker: seg.speaker,
      speakerLabel: resolveSpeakerLabel(seg.speaker, stage !== null),
      text: seg.text,
      isSection: seg.isSection,
      start: seg.start,
      end: seg.end,
      isHost: !seg.isSection && !seg.inDialogueBlock && HOST_SPEAKERS.has(seg.speaker.trim()),
      words,
      stage,
    };
  });
}

/**
 * 渲染用字幕行（舞台盒子内的一行 / 主持人独立一行）。
 */
export interface TranscriptLineVM {
  /** 该行对应的**全局片段下标**（高亮游标与点句跳播都用它）。 */
  segIdx: number;
  /** 说话人标记。 */
  speaker: string;
  /** 说话人展示名（对齐 iOS）。 */
  speakerLabel: string;
  /** 展示文本（无词节点时的兜底）。 */
  text: string;
  /** 是否章节标记。 */
  isSection: boolean;
  /** 是否主持人旁白。 */
  isHost: boolean;
  /** 起止时间（秒）。 */
  start: number;
  end: number;
  /** 词节点。 */
  words: TranscriptWordVM[];
  /** 是否盒子首行。 */
  isFirst: boolean;
  /** 是否盒子末行。 */
  isLast: boolean;
}

/** 宿主（主持人）独立区块。 */
export interface TranscriptHostBlockVM {
  /** 区分联合类型。 */
  kind: 'host';
  /** 列表 key。 */
  key: string;
  /** 单行内容。 */
  line: TranscriptLineVM;
}

/** 舞台盒子区块。 */
export interface TranscriptBoxBlockVM {
  /** 区分联合类型。 */
  kind: 'box';
  /** 列表 key。 */
  key: string;
  /** 盒子分组 ID（折叠判定用）。 */
  boxGroupId: number;
  /** 盒子类型。 */
  stageKind: StageKind;
  /** 顶部徽章文案。 */
  badgeText: string;
  /** 副标题。 */
  subText: string;
  /** 盒子内各行。 */
  lines: TranscriptLineVM[];
}

/** 渲染用字幕区块（主持人行或舞台盒子）。 */
export type TranscriptBlockVM = TranscriptHostBlockVM | TranscriptBoxBlockVM;

function toLine(vm: TranscriptSegmentVM, segIdx: number): TranscriptLineVM {
  return {
    segIdx,
    speaker: vm.speaker,
    speakerLabel: vm.speakerLabel,
    text: vm.text,
    isSection: vm.isSection,
    isHost: vm.isHost,
    start: vm.start,
    end: vm.end,
    words: vm.words,
    isFirst: false,
    isLast: false,
  };
}

/**
 * 取「实时句文本」（供课程库「继续收听」卡使用）。
 *
 * 规则（对齐 iOS）：优先当前段；若当前段是 section 或空文本，**向后找首个非 section
 * 且非空的段**；都找不到则返回空串（调用方回退到 `Tap to start listening...`）。
 */
export function findLiveSentenceText(segments: readonly Segment[], segIdx: number): string {
  const n = segments.length;
  if (n === 0) {
    return '';
  }
  const start = Math.min(Math.max(0, Math.trunc(segIdx)), n - 1);
  const cur = segments[start];
  if (cur && !cur.isSection && cur.text.trim()) {
    return cur.text.trim();
  }
  for (let i = start + 1; i < n; i += 1) {
    const seg = segments[i];
    if (!seg.isSection && seg.text.trim()) {
      return seg.text.trim();
    }
  }
  return '';
}

/**
 * 把片段视图模型**按连续同类分组**成区块序列：
 *   - 无舞台归属的片段 → 主持人独立行；
 *   - 连续同一 `boxGroupId` 的片段 → 一个舞台盒子（首/末行标记保留）。
 *
 * 这样 `transcript` 组件可用一个 `stage-box`（含 slot）承接整个盒子，
 * 折叠时只需改一个极小的 `collapsedBoxIds` 数组，无需重发整份字幕。
 */
export function toTranscriptBlocks(
  segments: readonly Segment[],
  track: AudioTrackKey,
  matcher: VocabMatcher,
): TranscriptBlockVM[] {
  const vms = toTranscriptSegments(segments, track, matcher);
  const blocks: TranscriptBlockVM[] = [];

  let i = 0;
  while (i < vms.length) {
    const vm = vms[i];
    if (!vm.stage) {
      blocks.push({ kind: 'host', key: `h${i}`, line: toLine(vm, i) });
      i += 1;
      continue;
    }

    const gid = vm.stage.boxGroupId;
    const lines: TranscriptLineVM[] = [];
    let j = i;
    while (j < vms.length && vms[j].stage && vms[j].stage!.boxGroupId === gid) {
      lines.push(toLine(vms[j], j));
      j += 1;
    }
    if (lines.length > 0) {
      lines[0].isFirst = true;
      lines[lines.length - 1].isLast = true;
    }
    blocks.push({
      kind: 'box',
      key: `b${gid}`,
      boxGroupId: gid,
      stageKind: vm.stage.kind,
      badgeText: vm.stage.badgeText,
      subText: vm.stage.subText,
      lines,
    });
    i = j;
  }

  return blocks;
}

/**
 * 构建 Vocab 面板条目（含课内例句）。
 *
 * 例句来源：在**两条音轨**的片段中，找出文本包含该词汇短语的句子，取前
 * `maxExamples` 条。点例句跳播时按 `(track, segIdx)` 定位。
 */
export function buildVocabEntries(
  vocabulary: readonly VocabEntry[],
  tracks: { dg: readonly Segment[]; pb: readonly Segment[] },
  maxExamples = 3,
): VocabEntryVM[] {
  const matcher = buildVocabMatcher(vocabulary);
  const examplesFor = (word: string): VocabExampleVM[] => {
    const out: VocabExampleVM[] = [];
    const tracksList: Array<{ key: AudioTrackKey; segs: readonly Segment[] }> = [
      { key: 'pb', segs: tracks.pb },
      { key: 'dg', segs: tracks.dg },
    ];
    for (const t of tracksList) {
      for (let i = 0; i < t.segs.length; i += 1) {
        const seg = t.segs[i];
        if (seg.isSection || !seg.text.trim()) {
          continue;
        }
        if (matcher.matchesText(seg.text) && seg.text.toLowerCase().includes(word.toLowerCase())) {
          out.push({ track: t.key, segIdx: i, text: seg.text.trim() });
          if (out.length >= maxExamples) {
            return out;
          }
        }
      }
    }
    return out;
  };

  return vocabulary.map((entry, index) => ({
    index,
    type: entry.type,
    word: entry.word,
    pos: entry.pos,
    definition: entry.definition,
    examples: examplesFor(entry.word),
  }));
}
