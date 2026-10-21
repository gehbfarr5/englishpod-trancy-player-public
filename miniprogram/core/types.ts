/**
 * ============================================================================
 *  核心数据类型层（core/ —— 纯 TypeScript，零平台依赖）
 * ============================================================================
 *  本目录严禁出现任何 `wx.*` / 平台专有 API 调用。
 *  这是为将来扩展到支付宝小程序 / 抖音小程序预留的生命线：
 *  所有端都复用 core/，各端只需实现 `adapters/<platform>/` 下的适配器。
 *
 *  字段命名约定：
 *   - 面向 TS 的字段统一使用 camelCase；
 *   - 与源 JSON 的 snake_case / 大小写差异由 `core/lessonModel.ts` 的解析器处理。
 *
 *  时间单位约定：**统一使用秒（number, float）**。
 *  唯一例外是 `LessonProgressRecord.updatedAtMs`，其为毫秒时间戳（与 Flutter 端对齐）。
 * ============================================================================
 */

/** 音轨键：`dg` = Dialogue 对话；`pb` = Podcast 讲解。 */
export type AudioTrackKey = 'dg' | 'pb';

/** 词级时间戳。 */
export interface WordTiming {
  /** 词面文本（保留原始大小写与标点，供高亮渲染）。 */
  word: string;
  /** 起始时间（秒）。 */
  start: number;
  /** 结束时间（秒）。 */
  end: number;
}

/** 句级片段（一句台词 / 一段旁白 / 一个章节标记）。 */
export interface Segment {
  /** 片段在该音轨内的顺序 ID，从 0 递增。 */
  id: number;
  /** 说话人标记（如 `A` / `B` / `M` / `C` / `Voice` / `SECTION`）。 */
  speaker: string;
  /** 展示文本（未做对齐清洗，保留原始标点）。 */
  text: string;
  /** 是否为章节标记（如 `DIALOGUE, FIRST TIME`），章节标记无 words。 */
  isSection: boolean;
  /** 是否处于「对话回放块」内（即 pb 音轨里嵌入的 dg 对话片段）。 */
  inDialogueBlock: boolean;
  /** 起始时间（秒）。 */
  start: number;
  /** 结束时间（秒）。 */
  end: number;
  /** 词级时间戳列表，按时间递增且互不重叠。 */
  words: WordTiming[];
}

/** 词汇表条目。 */
export interface VocabEntry {
  /** 类型：`key`（核心词）| `supplementary`（补充词）。 */
  type: string;
  /** 词 / 短语本身。 */
  word: string;
  /** 词性（如 `Phrase` / `Verb` / `Noun`）。 */
  pos: string;
  /** 释义。 */
  definition: string;
}

/**
 * 音频资源路径集合。
 *
 * 注意：自本次小程序改造起，这里存的是**相对逻辑路径**（如 `audio/0001/dg.m4a`），
 * 而非源数据里生产者本机的绝对路径。`null` 表示该音轨本期不提供。
 */
export interface AudioPaths {
  /** Dialogue 对话音轨相对路径。 */
  dg: string | null;
  /** Podcast 讲解音轨相对路径。 */
  pb: string | null;
  /** 复习音轨相对路径（本期不上传，恒为 null）。 */
  rv: string | null;
}

/**
 * 课程库轻量索引项（对应 `index.json` 的单条记录）。
 *
 * 源数据键名说明：索引里用的是**小写** `lesson_id`。
 */
export interface LessonIndexItem {
  /** 课程编号（1–365，缺 121–150）。 */
  lessonNumber: number;
  /** 课程 ID（4 位零填充字符串，如 `0001`）。 */
  lessonId: string;
  /** 课程 code（如 `B0001`）。 */
  code: string;
  /** 难度等级（如 `Elementary`）。 */
  level: string;
  /** 课程标题。 */
  title: string;
  /** Dialogue 音轨片段数。 */
  dgCount: number;
  /** Podcast 音轨片段数。 */
  pbCount: number;
  /** 词汇表条目数。 */
  vocabCount: number;
  /** 音频相对路径集合。 */
  audio: AudioPaths;
}

/**
 * 单课详情（对应 `lesson_XXXX.json`）。
 *
 * 源数据键名说明：详情里用的是**大写** `LessonId`。
 * 解析器需同时兼容 `lesson_id` 与 `LessonId`，缺字段时显式报错（不静默回退）。
 */
export interface LessonDetail {
  /** 课程编号。 */
  lessonNumber: number;
  /** 课程 ID。 */
  lessonId: string;
  /** 课程 code。 */
  code: string;
  /** 难度等级。 */
  level: string;
  /** 清洗后的展示标题。 */
  title: string;
  /** 原始标题（保留难度前缀与 code 后缀）。 */
  rawTitle: string;
  /** 音频相对路径集合。 */
  audio: AudioPaths;
  /** 词汇表。 */
  vocabulary: VocabEntry[];
  /** 双音轨片段，按音轨键分组。 */
  tracks: {
    dg: Segment[];
    pb: Segment[];
  };
}

/**
 * 课程库进度**视图模型**（不再是持久化结构）。
 *
 * 自 EP-PBC-001 §4 落地后，落盘真源是 `core/learningRecord.ts` 的
 * `LessonLearningRecord`（双轨 `committedPositionMs` + 写入版本 + 完成解耦）。
 * 本结构只用来喂 `core/progressEngine.ts` 与课程库 UI，由
 * `toProgressView()` 从真源投影得到，**不得写回存储**。
 */
export interface LessonProgressRecord {
  /** 是否已完整学完（用户显式标记或进度达标）。 */
  isCompleted: boolean;
  /** 是否已开始过（用于区分「全新」与「从头回放」）。 */
  hasStarted: boolean;
  /** 实时进度百分比（0..100），以 Podcast `pb` 音轨的当前位置为准。 */
  progressPct: number;
  /** 最近一次播放的音轨。 */
  lastTrack: AudioTrackKey;
  /** Podcast 音轨当前播放位置（秒）。 */
  pbPosSec: number;
  /** Podcast 音轨当前所在片段索引。 */
  pbSegIdx: number;
  /** Podcast 音轨总时长（秒）。 */
  pbDurSec: number;
  /** Dialogue 音轨当前播放位置（秒）。 */
  dgPosSec: number;
  /** Dialogue 音轨当前所在片段索引。 */
  dgSegIdx: number;
  /** Dialogue 音轨总时长（秒）。 */
  dgDurSec: number;
  /** 最近更新时间（毫秒时间戳，与 Flutter 端对齐）。 */
  updatedAtMs: number;
}

/** 创建一条空的进度**视图**记录（仅课程库 UI/单测用，不落盘）。 */
export function createEmptyProgressRecord(): LessonProgressRecord {
  return {
    isCompleted: false,
    hasStarted: false,
    progressPct: 0,
    lastTrack: 'pb',
    pbPosSec: 0,
    pbSegIdx: 0,
    pbDurSec: 0,
    dgPosSec: 0,
    dgSegIdx: 0,
    dgDurSec: 0,
    updatedAtMs: 0,
  };
}

/**
 * 六态进度枚举。
 *
 * 设计原则：`isCompleted` 与 `progressPct` **解耦**——「进度接近 100%」
 * 不等于「用户已标记完成」，「已完成」也不妨碍用户从头/从中间回放。
 *
 * 判定规则（`deriveProgressState`，判定顺序自上而下，命中即返回）：
 *   1. New              —— 从未开始（`!hasStarted` 且 `progressPct <= 0`）
 *   2. Done             —— 已完成且停在结尾（`isCompleted` 且 `progressPct >= 95`）
 *   3. ReplayFromStart  —— 已完成但进度归零，属于「重听从头开始」（`isCompleted` 且 `progressPct <= 0`）
 *   4. ReplayPartial    —— 已完成但停在中间，属于「重听某一段」（`isCompleted` 且 `0 < progressPct < 95`）
 *   5. AlmostDone       —— 尚未标记完成但进度已 >= 95%，提示用户「差一点点」
 *   6. Resume           —— 进行中（`0 < progressPct < 95`），从当前位置继续
 */
export enum ProgressState {
  New = 'New',
  Resume = 'Resume',
  AlmostDone = 'AlmostDone',
  Done = 'Done',
  ReplayFromStart = 'ReplayFromStart',
  ReplayPartial = 'ReplayPartial',
}

/** 百分比阈值：达到或超过该值视为「已到结尾」。 */
export const PROGRESS_NEAR_END_PCT = 95;

/** 由进度记录推导六态（纯函数，零副作用）。 */
export function deriveProgressState(record: LessonProgressRecord): ProgressState {
  const pct = Number.isFinite(record.progressPct) ? record.progressPct : 0;

  if (!record.hasStarted && pct <= 0) {
    return ProgressState.New;
  }
  if (record.isCompleted) {
    if (pct >= PROGRESS_NEAR_END_PCT) {
      return ProgressState.Done;
    }
    if (pct <= 0) {
      return ProgressState.ReplayFromStart;
    }
    return ProgressState.ReplayPartial;
  }
  if (pct >= PROGRESS_NEAR_END_PCT) {
    return ProgressState.AlmostDone;
  }
  return ProgressState.Resume;
}

/**
 * 云端数据适配器契约（端口）。
 *
 * 放在 core/ 是为了让「业务层依赖抽象而非实现」：
 * 微信端由 `adapters/wechat/cloud.ts` 实现；将来接入其他端时再写各自实现即可，
 * 业务层代码零改动。
 */
export interface CloudAdapter {
  /** 拉取课程库轻量索引（335 条）。 */
  getLessonIndex(): Promise<LessonIndexItem[]>;
  /** 拉取单课详情（含双音轨词级时间戳）。 */
  getLessonDetail(lessonId: string): Promise<LessonDetail>;
  /**
   * 解析某课某音轨的云存储 fileID。
   *
   * 该方法是**同步**的：调用方应在 `getLessonIndex()` / 预热之后调用，
   * 优先使用预热索引的 file_ids，或使用详情提供的合法相对路径回退；
   * 不能臆造历史 M4A 资源。无法解析时返回空字符串。
   */
  resolveAudioFileId(lessonId: string, track: AudioTrackKey, relativeAudioPath?: string | null): string;
}

/**
 * 0.3.x 旧命名空间键（**已停用，仅为文档与「不删旧数据」约束留存**）。
 *
 * EP-PBC-001 §4.1.10：新版本从零使用新命名空间（`adapters/wechat/learningStore.ts`
 * 的 `ep_learning_v2_*`），不做旧数据迁移；设备上这些键里的旧记录既不会被读取，
 * 也不会被删除（删除他人设备数据需 owner 明确同意）。
 */
export const PROGRESS_MAP_STORAGE_KEY = 'ep_study_progress_v1';

/** 旧命名空间的「最近播放课程」键（已停用，同上）。 */
export const LAST_PLAYED_LESSON_KEY = 'ep_last_lesson_id';

/** 进度视图映射：以课程 ID 为键（课程库 UI 用）。 */
export type ProgressMap = Record<string, LessonProgressRecord>;

/** 播放速率档位（与 Flutter `_speedOptions` 对齐）。 */
export const PLAYBACK_RATES = [0.8, 0.9, 1.0, 1.1, 1.25] as const;

/** 播放速率类型（仅允许给定档位）。 */
export type PlaybackRate = (typeof PLAYBACK_RATES)[number];

/**
 * 音频适配器错误（已按原始 `errCode` 分类，供上层输出可读日志/降级）。
 *
 * `InnerAudioContext` 常见 `errCode`：
 *   10001 —— 系统错误；10002 —— 网络错误；10003 —— 文件错误；10004 —— 格式错误。
 */
export interface AudioAdapterError {
  /** 原始错误码（无则为 0）。 */
  errCode: number;
  /** 可读描述。 */
  message: string;
  /** 是否可重试（网络类错误可重试）。 */
  retriable: boolean;
}

/** 音频适配器事件回调集合（全部可选，均为前台回调）。 */
export interface AudioAdapterEvents {
  /** 播放进度更新（秒）。 */
  onTimeUpdate?: (positionSec: number) => void;
  /** 时长就绪/变化（秒）。 */
  onDurationChange?: (durationSec: number) => void;
  /** 开始播放。 */
  onPlay?: () => void;
  /** 暂停。 */
  onPause?: () => void;
  /** 自然播放结束。 */
  onEnded?: () => void;
  /** seek 完成。 */
  onSeeked?: (positionSec: number) => void;
  /** 出错（已分类）。 */
  onError?: (error: AudioAdapterError) => void;
  /** 缓冲中。 */
  onWaiting?: () => void;
  /** 可播放。 */
  onCanplay?: () => void;
  /**
   * 「上一句」（来自锁屏 / 耳机按键）。
   *
   * ⚠️ 仅部分平台支持：`BackgroundAudioManager.onPrev` **仅 iOS 有回调，Android 无**。
   * Android 端必须依赖应用内「上句」按钮，适配层不保证该事件一定触发。
   */
  onPrev?: () => void;
  /** 「下一句」（同上，仅部分平台，如 iOS `BackgroundAudioManager.onNext`）。 */
  onNext?: () => void;
}

/**
 * 锁屏 / 通知栏播放器元数据（平台无关）。
 *
 * 仅部分适配器实现（如 `BackgroundAudioManager`）；前台 `InnerAudioContext` 忽略。
 */
export interface AudioMetadata {
  /** 标题（必填，BAM 要求非空）。 */
  title: string;
  /** 专辑名 / 节目名。 */
  album?: string;
  /** 歌手 / 作者。 */
  artist?: string;
  /** 封面图片地址（原生播放器背景图；建议用 https，本地包内路径部分平台不渲染）。 */
  coverImgUrl?: string;
}

/**
 * 音频适配器端口（音频播放抽象）。
 *
 * 放在 core/ 让业务层依赖抽象：微信端由 `adapters/wechat/` 下的
 * `backgroundAudio.ts`（`BackgroundAudioManager`，支持后台/锁屏）或
 * `audio.ts`（`InnerAudioContext`，前台低延迟）实现；
 * 开发者工具里可用 `fakeAudio.ts` 的虚拟时钟实现。所有实现均无 `wx.*` 泄漏到 core。
 */
export interface AudioAdapter {
  /** 绑定事件回调（覆盖式）。 */
  setEvents(events: AudioAdapterEvents): void;
  /** 载入音频源（src 为可播放地址；虚拟实现可忽略）。 */
  load(src: string): void;
  /** 播放。 */
  play(): void;
  /** 暂停。 */
  pause(): void;
  /** 跳转到指定位置（秒）。 */
  seek(positionSec: number): void;
  /** 设置播放速率。 */
  setPlaybackRate(rate: PlaybackRate): void;
  /** 当前是否暂停。 */
  isPaused(): boolean;
  /** 当前播放位置（秒）。 */
  getPositionSec(): number;
  /** 当前总时长（秒，未知为 0）。 */
  getDurationSec(): number;
  /** 可选：设置锁屏/通知栏元数据（仅部分平台实现，如 `BackgroundAudioManager`）。 */
  setMetadata?(meta: AudioMetadata): void;
  /** 销毁并解绑（页面 onUnload 必须调用，否则事件重复绑定会导致抖动）。 */
  destroy(): void;
}
