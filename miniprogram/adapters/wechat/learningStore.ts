/**
 * ============================================================================
 *  学习进度存储适配器（adapters/wechat/learningStore.ts）
 * ============================================================================
 *  规范来源：EP-PBC-001 §4（数据模型）/ §4.1.4（写入版本）/ §4.1.8（写入失败）/
 *           §4.1.9（损坏隔离）/ §4.1.10（新命名空间，不迁移旧测试版）
 *
 *  与旧 `adapters/wechat/storage.ts` 的关键差别：
 *    1. **一课一个 key**：`ep_learning_v2_record_<lessonId>`。一节坏数据只影响
 *       那一课（§4.1.9 的隔离单元），不会让整张进度表一起回落成空。
 *    2. **没有写防抖**：旧实现的 400ms 尾部防抖会「把 pending 写入用陈旧读回滚」，
 *       因此这里每次提交**同步落盘**；节流交给调用方（约 3s 周期，§4.1.1）。
 *    3. **内存镜像 + 版本守卫**：写入带 `revision`，版本不大于已存版本的写入被
 *       拒绝（§4.1.4），因此不存在「旧异步写入盖掉新写入」。
 *    4. **写入失败如实返回 false**：绝不谎报已保存（§4.1.8）；内存镜像仍然可用。
 *    5. **新命名空间**：旧 `ep_study_progress_v1` / `ep_last_lesson_id` 既不读取，
 *       也不删除（§4.1.10；删除他人设备上的数据需 owner 明确同意）。
 * ============================================================================
 */

import {
  DevicePreferences,
  LEARNING_SCHEMA_VERSION,
  LessonLearningRecord,
  ResumeAnchor,
  createDefaultPreferences,
  createLearningRecord,
  normalizeLearningRecord,
  normalizePreferences,
  normalizeResumeAnchor,
} from '../../core/learningRecord';

/** 单课记录的存储键前缀（§4.1.10 新命名空间）。 */
export const RECORD_KEY_PREFIX = 'ep_learning_v2_record_';

/** 设备偏好存储键。 */
export const PREFERENCES_KEY = 'ep_learning_v2_prefs';

/** 恢复锚点存储键。 */
export const RESUME_ANCHOR_KEY = 'ep_learning_v2_resume';

/** 单 key 上限（微信小程序单 key ≤ 1MB）。 */
export const MAX_SINGLE_KEY_BYTES = 1024 * 1024;

/**
 * 旧测试版遗留键（0.3.5 及更早）。
 *
 * **白名单，硬编码，只有这两个**：清理时绝不按前缀或通配删除，避免误伤
 * `ep_learning_v2_*` 新命名空间（§4.1.10）。owner 已于 2026-10-20 授权清除。
 */
export const LEGACY_KEYS = ['ep_study_progress_v1', 'ep_last_lesson_id'] as const;

/** 一次性清理完成标记（存在即表示已清理过，不必每次启动都扫）。 */
export const LEGACY_PURGE_MARKER_KEY = 'ep_learning_v2_legacy_purged';

/** 同步键值端口：让存储层可在单测里注入内存实现（core 不依赖 wx）。 */
export interface SyncKeyValue {
  /** 读取原始值；不存在返回 `''` / undefined。 */
  get(key: string): unknown;
  /** 写入字符串；失败返回 false（不抛错）。 */
  set(key: string, value: string): boolean;
  /** 删除键；失败返回 false（不抛错）。 */
  remove(key: string): boolean;
  /** 列出全部键（用于枚举本命名空间下的课程）。 */
  keys(): string[];
}

/** UTF-8 字节数（不依赖 Buffer / TextEncoder）。 */
export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      i += 1;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

/** 微信 `wx.*StorageSync` 端口实现。 */
export function createWxKeyValue(): SyncKeyValue {
  return {
    get(key: string): unknown {
      try {
        return wx.getStorageSync(key);
      } catch (err) {
        console.warn('[learningStore] 读取失败：', key, err);
        return undefined;
      }
    },
    set(key: string, value: string): boolean {
      try {
        wx.setStorageSync(key, value);
        return true;
      } catch (err) {
        console.error('[learningStore] 写入失败（可能容量超限）：', key, err);
        return false;
      }
    },
    remove(key: string): boolean {
      try {
        wx.removeStorageSync(key);
        return true;
      } catch (err) {
        console.warn('[learningStore] 删除失败：', key, err);
        return false;
      }
    },
    keys(): string[] {
      try {
        return wx.getStorageInfoSync().keys ?? [];
      } catch (err) {
        console.warn('[learningStore] 读取键列表失败：', err);
        return [];
      }
    },
  };
}

/** 单课记录写入结果：`ok` 已落盘；`stale` 版本落后已被拒；`io-error` 落盘失败。 */
export type SaveOutcome = 'ok' | 'stale' | 'io-error';

/** 存储层内部镜像条目。 */
interface MirrorEntry {
  record: LessonLearningRecord;
  /** 该版本是否已确认落盘（§4.1.8：内存可用 ≠ 已保存）。 */
  persisted: boolean;
}

/**
 * 课程学习记录存储。
 *
 * 单例语义：`services/progressJournal.ts` 持有唯一实例，页面不得自行 new
 * （多实例会各自维护内存镜像，重新引入双写竞争）。
 */
export class LearningStore {
  private readonly mirror = new Map<string, MirrorEntry>();

  /** 最近一次写入是否失败（诊断/日志用，不对外暴露为「已保存」）。 */
  private writeFailures = 0;

  constructor(private readonly kv: SyncKeyValue = createWxKeyValue()) {}

  /** 读取单课记录（内存镜像优先；无则从存储解析，坏数据回退默认值）。 */
  loadRecord(lessonId: string, nowMs = 0): LessonLearningRecord {
    if (!lessonId) {
      return createLearningRecord('', nowMs);
    }
    const cached = this.mirror.get(lessonId);
    if (cached) {
      return { ...cached.record };
    }
    const raw = this.kv.get(RECORD_KEY_PREFIX + lessonId);
    let parsed: unknown = null;
    if (typeof raw === 'string' && raw.length > 0) {
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        // 损坏隔离（§4.1.9）：只回退本课，保留原始内容便于排查，且不删数据。
        console.warn('[learningStore] 课程记录 JSON 损坏，已回退默认值：', lessonId, err);
        parsed = null;
      }
    }
    const record = normalizeLearningRecord(lessonId, parsed, nowMs);
    this.mirror.set(lessonId, { record, persisted: parsed !== null });
    return { ...record };
  }

  /**
   * 写入单课记录。
   *
   * 版本守卫同时比对**存储里已落盘的版本**与内存镜像版本：多实例（旧进程迟到写、
   * 课程库与播放页各自 new 一个 store）情况下，只比内存镜像会漏掉对方刚写入的
   * 新版本（§4.1.4「旧异步写入不得覆盖新写入」）。
   */
  saveRecord(record: LessonLearningRecord): SaveOutcome {
    const lessonId = record.lessonId;
    if (!lessonId) {
      return 'io-error';
    }
    const key = RECORD_KEY_PREFIX + lessonId;
    const persistedRevision = this.persistedRevision(key);
    const mirrorRevision = this.mirror.has(lessonId)
      ? this.mirror.get(lessonId)!.record.revision
      : 0;
    const baseRevision = Math.max(persistedRevision, mirrorRevision);
    if (record.revision <= baseRevision) {
      // §4.1.4：旧版本写入不得覆盖新版本。
      console.warn(
        '[learningStore] 拒绝过期写入：',
        lessonId,
        `rev ${record.revision} <= ${baseRevision}`,
      );
      // 同步内存镜像到存储里的较新版本，避免下一次写入继续用旧基线。
      if (persistedRevision > mirrorRevision) {
        this.mirror.delete(lessonId);
      }
      return 'stale';
    }

    const payload = JSON.stringify({ ...record, schemaVersion: LEARNING_SCHEMA_VERSION });
    const ok = utf8ByteLength(payload) > MAX_SINGLE_KEY_BYTES
      ? false
      : this.kv.set(key, payload);

    // §4.1.8：写入失败时内存状态仍可继续使用，但不能对外宣称已保存。
    this.mirror.set(lessonId, { record: { ...record }, persisted: ok });
    if (!ok) {
      this.writeFailures += 1;
      return 'io-error';
    }
    return 'ok';
  }

  /** 读取存储里某课记录的版本号（无记录/损坏为 0）。 */
  private persistedRevision(key: string): number {
    const raw = this.kv.get(key);
    if (typeof raw !== 'string' || raw.length === 0) {
      return 0;
    }
    try {
      const parsed = JSON.parse(raw) as { revision?: unknown };
      return typeof parsed.revision === 'number' && Number.isFinite(parsed.revision)
        ? Math.max(0, Math.trunc(parsed.revision))
        : 0;
    } catch {
      return 0;
    }
  }

  /** 最近一次写入是否失败。 */
  hasWriteFailure(): boolean {
    return this.writeFailures > 0;
  }

  /** 某课当前内存版本是否已确认落盘。 */
  isPersisted(lessonId: string): boolean {
    const entry = this.mirror.get(lessonId);
    return entry ? entry.persisted : false;
  }

  /** 枚举本命名空间下已存在的课程 ID（升序，含内存镜像中的）。 */
  knownLessonIds(): string[] {
    const ids = new Set<string>(this.mirror.keys());
    for (const key of this.kv.keys()) {
      if (key.startsWith(RECORD_KEY_PREFIX)) {
        const id = key.slice(RECORD_KEY_PREFIX.length);
        if (id) {
          ids.add(id);
        }
      }
    }
    return Array.from(ids).sort();
  }

  /** 读取设备偏好（坏数据回退默认值）。 */
  loadPreferences(): DevicePreferences {
    const raw = this.kv.get(PREFERENCES_KEY);
    if (typeof raw !== 'string' || raw.length === 0) {
      return createDefaultPreferences();
    }
    try {
      return normalizePreferences(JSON.parse(raw));
    } catch (err) {
      console.warn('[learningStore] 设备偏好损坏，已回退默认值：', err);
      return createDefaultPreferences();
    }
  }

  /** 写入设备偏好。 */
  savePreferences(prefs: DevicePreferences): boolean {
    return this.kv.set(PREFERENCES_KEY, JSON.stringify(prefs));
  }

  /** 读取恢复锚点（§4.1.7）。 */
  loadResumeAnchor(): ResumeAnchor {
    const raw = this.kv.get(RESUME_ANCHOR_KEY);
    if (typeof raw !== 'string' || raw.length === 0) {
      return { schemaVersion: LEARNING_SCHEMA_VERSION, lastOpenedLessonId: null };
    }
    try {
      return normalizeResumeAnchor(JSON.parse(raw));
    } catch (err) {
      console.warn('[learningStore] 恢复锚点损坏，已回退为空：', err);
      return { schemaVersion: LEARNING_SCHEMA_VERSION, lastOpenedLessonId: null };
    }
  }

  /** 写入恢复锚点。 */
  saveResumeAnchor(anchor: ResumeAnchor): boolean {
    return this.kv.set(RESUME_ANCHOR_KEY, JSON.stringify(anchor));
  }

  /**
   * 一次性清除旧测试版遗留键（§4.1.10；owner 2026-10-20 授权）。
   *
   * 只删 {@link LEGACY_KEYS} 里的两个键，**不按前缀扫、不通配**，因此
   * `ep_learning_v2_record_*` / `_prefs` / `_resume` 绝不会被碰到。
   * 幂等：清理后写标记；标记存在时直接返回（旧版本客户端可能重写旧键，
   * 下次启动会再清一次，仍然只动这两个键）。
   *
   * @returns 本次实际删除的键（为空表示无遗留数据）。
   */
  purgeLegacyKeys(): { removed: string[]; alreadyPurged: boolean } {
    const alreadyPurged = this.kv.get(LEGACY_PURGE_MARKER_KEY) === '1';
    const existing = new Set(this.kv.keys());
    const removed: string[] = [];
    for (const key of LEGACY_KEYS) {
      if (!existing.has(key) && this.kv.get(key) === '') {
        continue;
      }
      if (this.kv.remove(key)) {
        removed.push(key);
      }
    }
    if (!alreadyPurged) {
      this.kv.set(LEGACY_PURGE_MARKER_KEY, '1');
    }
    return { removed, alreadyPurged };
  }

  /** 读原始聚合权限：存档标记是否存在（诊断/测试用）。 */
  isLegacyPurged(): boolean {
    return this.kv.get(LEGACY_PURGE_MARKER_KEY) === '1';
  }
}
