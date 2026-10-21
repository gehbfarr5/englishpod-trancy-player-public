/**
 * ============================================================================
 *  微信端适配器（adapters/wechat/cloud.ts）
 * ============================================================================
 *  这是**全项目唯一**允许调用 `wx.cloud.*` 的数据出入口之一（另一个是 `app.ts` 的初始化）。
 *  业务层只依赖 `core/types.ts` 中的 `CloudAdapter` 抽象，不直接触碰 `wx.*`。
 *
 *  能力：
 *   - `getLessonIndex()`  —— 拉取课程库轻量索引，并缓存 fileID 映射；
 *   - `getLessonDetail()` —— 拉取单课详情（云函数在云端解压 gz 后返回 JSON）；
 *   - `resolveAudioFileId()` —— 同步解析某课某音轨的云存储 fileID。
 *
 *  稳健性：
 *   - 每个云函数调用带**超时**（默认 8s）与**指数退避重试**（最多 2 次）；
 *   - 返回前一律用 `core/lessonModel.ts` 的解析器做强校验，杜绝脏数据穿透。
 * ============================================================================
 */

import {
  CLOUD_CALL_MAX_RETRIES,
  CLOUD_CALL_RETRY_BASE_MS,
  CLOUD_CALL_TIMEOUT_MS,
  CLOUD_FUNCTION_NAMES,
  CLOUD_STORAGE_FILEID_PREFIX,
} from '../../config/env';
import { parseLessonDetail, parseLessonIndex } from '../../core/lessonModel';
import { AudioTrackKey, CloudAdapter, LessonDetail, LessonIndexItem } from '../../core/types';

/** 云函数统一返回信封。 */
interface CloudEnvelope<T> {
  success: boolean;
  data: T | null;
  error: { code: string; message: string } | null;
}

/** `wx.cloud.callFunction` 的返回结构（仅取我们关心的字段）。 */
interface CloudCallRawResult {
  result?: unknown;
  errMsg?: string;
}

/** 音轨 fileID 映射。 */
type FileIdMap = Record<AudioTrackKey, string>;

/** 简单毫秒延时。 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 从「未知结构」中读出任意键的字符串值（用于读取 file_ids 这类弱类型字段）。 */
function readLooseString(source: unknown, ...keys: string[]): string {
  if (typeof source !== 'object' || source === null) {
    return '';
  }
  const record = source as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return '';
}

/**
 * 调用云函数，带超时保护。
 *
 * 用 Promise.race 实现超时：即便底层 SDK 不响应，也会在上限时间后 reject，
 * 避免页面逻辑被挂死。
 */
function callFunctionWithTimeout<T>(
  name: string,
  data: Record<string, unknown>,
  timeoutMs: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      reject(new Error(`[cloud] 调用云函数 "${name}" 超时（>${timeoutMs}ms）`));
    }, timeoutMs);

    wx.cloud
      .callFunction({ name, data })
      .then((res: CloudCallRawResult) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(res.result as T);
      })
      .catch((err: unknown) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      });
  });
}

/**
 * 调用云函数，带指数退避重试。
 *
 * 总尝试次数 = 1（首次） + CLOUD_CALL_MAX_RETRIES。退避时长 = base * 2^attempt。
 */
async function callFunctionWithRetry<T>(
  name: string,
  data: Record<string, unknown> = {},
): Promise<T> {
  let lastError: Error = new Error(`[cloud] 调用云函数 "${name}" 失败`);

  for (let attempt = 0; attempt <= CLOUD_CALL_MAX_RETRIES; attempt += 1) {
    try {
      return await callFunctionWithTimeout<T>(name, data, CLOUD_CALL_TIMEOUT_MS);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const isLastAttempt = attempt >= CLOUD_CALL_MAX_RETRIES;
      if (!isLastAttempt) {
        const backoffMs = CLOUD_CALL_RETRY_BASE_MS * Math.pow(2, attempt);
        console.warn(
          `[cloud] "${name}" 第 ${attempt + 1} 次调用失败，${backoffMs}ms 后重试：${lastError.message}`,
        );
        await delay(backoffMs);
      }
    }
  }

  throw lastError;
}

/** 拆解云函数统一信封；非信封结构（如老函数直接返回数据）原样返回。 */
function unwrapEnvelope<T>(name: string, raw: unknown): T {
  if (typeof raw === 'object' && raw !== null && 'success' in (raw as Record<string, unknown>)) {
    const envelope = raw as CloudEnvelope<T>;
    if (!envelope.success) {
      const code = envelope.error ? envelope.error.code : 'UNKNOWN';
      const message = envelope.error ? envelope.error.message : '未知错误';
      throw new Error(`[cloud] 云函数 "${name}" 返回失败：${code} ${message}`);
    }
    return envelope.data as T;
  }
  return raw as T;
}

/** 微信端云开发适配器实现。 */
export class WechatCloudAdapter implements CloudAdapter {
  /** lessonId -> { dg, pb } 的 fileID 映射，在 getLessonIndex 预热时填充。 */
  private readonly fileIdMap: Map<string, FileIdMap> = new Map<string, FileIdMap>();

  /** 拉取课程库索引，并顺带缓存每个课程的音频 fileID（若云端提供）。 */
  async getLessonIndex(): Promise<LessonIndexItem[]> {
    const raw = await callFunctionWithRetry<unknown>(CLOUD_FUNCTION_NAMES.getLessonIndex, {
      limit: 335,
      offset: 0,
    });
    const payload = unwrapEnvelope<unknown>(CLOUD_FUNCTION_NAMES.getLessonIndex, raw);

    // 支持两种返回形态：数组本身，或 { items: [...] }。
    const items: unknown[] = Array.isArray(payload)
      ? payload
      : Array.isArray((payload as { items?: unknown[] } | null)?.items)
        ? ((payload as { items: unknown[] }).items)
        : [];
    if (items.length === 0) {
      throw new Error('[cloud] getLessonIndex 返回空索引或结构非法（期望数组或 { items: [...] }）');
    }

    this.fileIdMap.clear();
    for (const item of items) {
      const lessonId = readLooseString(item, 'lesson_id', 'LessonId');
      const fileIds = (item as Record<string, unknown> | null)?.file_ids;
      if (!lessonId || typeof fileIds !== 'object' || fileIds === null) {
        continue;
      }
      const dg = readLooseString(fileIds, 'dg');
      const pb = readLooseString(fileIds, 'pb');
      if (dg || pb) {
        this.fileIdMap.set(lessonId, { dg, pb });
      }
    }

    return parseLessonIndex(items);
  }

  /** 拉取单课详情（云函数侧已完成 gz 解压）。 */
  async getLessonDetail(lessonId: string): Promise<LessonDetail> {
    if (!lessonId) {
      throw new Error('[cloud] getLessonDetail: lessonId 不能为空');
    }
    const raw = await callFunctionWithRetry<unknown>(CLOUD_FUNCTION_NAMES.getLessonDetail, {
      lessonId,
    });
    const payload = unwrapEnvelope<unknown>(CLOUD_FUNCTION_NAMES.getLessonDetail, raw);
    return parseLessonDetail(payload);
  }

  /**
   * 解析某课某音轨云存储 fileID，优先使用在线索引的 file_ids。
   * 当该字段缺失时，仅可使用当前详情提供的、与课程和音轨匹配的相对路径。
   * 禁止凭过时的固定 .m4a 模板构造不存在的云存储对象。
   */
  resolveAudioFileId(
    lessonId: string,
    track: AudioTrackKey,
    relativeAudioPath?: string | null,
  ): string {
    const mapped = this.fileIdMap.get(lessonId);
    if (mapped && mapped[track]) {
      return mapped[track];
    }

    const path = typeof relativeAudioPath === 'string' ? relativeAudioPath.trim() : '';
    const match = /^audio\/(\d{4})\/(dg|pb)\.(mp3|m4a)$/.exec(path);
    if (match && match[1] === lessonId && match[2] === track && CLOUD_STORAGE_FILEID_PREFIX) {
      const prefix = CLOUD_STORAGE_FILEID_PREFIX.replace(/\/+$/, '');
      return `${prefix}/${path}`;
    }

    console.warn(
      `[cloud] 音频地址不可用：课程 ${lessonId}，音轨 ${track}；` +
        '索引无 file_ids，详情无匹配的音频相对路径。',
    );
    return '';
  }
}
