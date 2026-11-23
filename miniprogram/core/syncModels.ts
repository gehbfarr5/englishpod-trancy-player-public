/**
 * ============================================================================
 *  多端进度同步核心数据契约与纯函数（core/syncModels.ts —— 零平台依赖）
 * ============================================================================
 *  规范来源：EP-SYNC-001 v1.0（与 sync_server Go DTO 完全一一对应）
 *  约束：严禁引用 wx.*、DOM 或 Node 专属 API。
 * ============================================================================
 */

import { LessonLearningRecord } from './learningRecord';
import { AudioTrackKey } from './types';

export const SYNC_SCHEMA_VERSION = 1;
export const SYNC_STATE_STORAGE_KEY = 'ep_sync_v1_state';
export const CANONICAL_LESSON_COUNT = 335;
export const SYNC_PUSH_CHUNK_SIZE = 80;
export const SYNC_DEBOUNCE_MS = 2000;
export const SYNC_HEARTBEAT_INTERVAL_MS = 45000;
export const SYNC_PAIR_POLL_INTERVAL_MS = 2000;
export const SYNC_PULL_MIN_INTERVAL_MS = 10000;
export const MAX_TRACK_DURATION_MS = 7_200_000;
export const MAX_SEGMENT_INDEX = 5000;

/** 31 位无歧义配对码字符表（剔除 0, O, 1, I, L）。 */
export const PAIRING_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const PAIRING_CODE_LENGTH = 8;

const PAIRING_CHAR_SET = new Set(PAIRING_ALPHABET.split(''));

export type SyncPlatform = 'ios' | 'ipad' | 'android' | 'web' | 'wechat' | 'harmonyos';

export type SyncConnectionStatus = 'unlinked' | 'synced' | 'syncing' | 'offline' | 'error';

export type PairingTicketStatus = 'pending' | 'consumed' | 'expired';

export interface SyncKeyValuePort {
  get(key: string): unknown;
  set(key: string, value: string): boolean;
  remove(key: string): boolean;
}

export interface SyncDeviceSummary {
  readonly deviceId: string;
  readonly deviceName: string;
  readonly platform: SyncPlatform | string;
  readonly createdAtMs: number;
  readonly lastSeenAtMs: number;
  readonly isCurrent: boolean;
}

export interface PairingTicket {
  readonly groupId: string;
  readonly deviceId: string;
  readonly deviceToken?: string;
  readonly code: string;
  readonly displayCode: string;
  readonly qrPayload: string;
  readonly expiresAtMs: number;
  readonly serverTimeMs: number;
}

export interface ClaimedDeviceInfo {
  readonly deviceId: string;
  readonly deviceName: string;
  readonly platform: string;
  readonly consumedAtMs: number;
}

export interface PairingStatusResult {
  readonly code: string;
  readonly displayCode: string;
  readonly status: PairingTicketStatus;
  readonly expiresAtMs: number;
  readonly serverTimeMs: number;
  readonly claimedDevice?: ClaimedDeviceInfo;
}

export interface ClaimPairResult {
  readonly groupId: string;
  readonly deviceId: string;
  readonly deviceToken: string;
  readonly serverSeq: number;
  readonly serverTimeMs: number;
  readonly devices: readonly SyncDeviceSummary[];
}

export interface SyncTrackPointInput {
  readonly positionMs: number;
  readonly segmentIndex?: number;
  readonly durationMs?: number;
  readonly updatedAtMs: number;
  readonly baseSeq: number;
}

export interface SyncTrackPointOutput {
  readonly positionMs: number;
  readonly segmentIndex?: number;
  readonly durationMs?: number;
  readonly updatedAtMs: number;
  readonly seq: number;
}

export interface SyncLastOpenedInput {
  readonly lessonId: string;
  readonly updatedAtMs: number;
  readonly baseSeq: number;
}

export interface SyncLastOpenedOutput {
  readonly lessonId: string;
  readonly updatedAtMs: number;
  readonly seq: number;
}

export interface SyncLessonPushInput {
  readonly lessonId: string;
  readonly lessonCompleted: boolean;
  readonly completedAtMs?: number;
  readonly pb?: SyncTrackPointInput;
  readonly dg?: SyncTrackPointInput;
}

export interface SyncPushRequest {
  readonly lessons: readonly SyncLessonPushInput[];
  readonly lastOpened?: SyncLastOpenedInput;
}

export interface SyncRejectedConflict {
  readonly lessonId: string;
  readonly track: AudioTrackKey;
  readonly reason: string;
  readonly serverTrack: SyncTrackPointOutput;
}

export interface SyncPushResult {
  readonly serverSeq: number;
  readonly serverTimeMs: number;
  readonly acceptedLessons: readonly string[];
  readonly rejectedConflicts: readonly SyncRejectedConflict[];
  readonly lastOpened?: SyncLastOpenedOutput | null;
}

export interface SyncLessonPullOutput {
  readonly lessonId: string;
  readonly lessonCompleted: boolean;
  readonly completedAtMs?: number;
  readonly seq: number;
  readonly pb: SyncTrackPointOutput | null;
  readonly dg: SyncTrackPointOutput | null;
}

export interface SyncPullResult {
  readonly serverSeq: number;
  readonly serverTimeMs: number;
  readonly hasMore: boolean;
  readonly lastOpened: SyncLastOpenedOutput | null;
  readonly lessons: readonly SyncLessonPullOutput[];
}

export interface SyncErrorPayload {
  readonly status: number;
  readonly code: string;
  readonly message: string;
  readonly retryAfterSec?: number;
}

export class SyncApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfterSec?: number;

  constructor(payload: SyncErrorPayload) {
    super(payload.message);
    this.name = 'SyncApiError';
    this.status = payload.status;
    this.code = payload.code;
    this.retryAfterSec = payload.retryAfterSec;
  }
}

export interface PersistedSyncState {
  schemaVersion: number;
  groupId: string;
  deviceId: string;
  deviceToken: string;
  deviceName: string;
  lastSyncedSeq: number;
  lastSyncedAtMs: number;
  clockOffsetMs: number;
  trackBaseSeq: Record<string, number>;
  lastOpenedSeq: number;
  dirtyLessonIds: string[];
  dirtyLastOpened: boolean;
  devices: SyncDeviceSummary[];
}

export interface SyncEngineSnapshot {
  readonly linked: boolean;
  readonly status: SyncConnectionStatus;
  readonly groupId: string;
  readonly deviceId: string;
  readonly deviceName: string;
  readonly lastSyncedSeq: number;
  readonly lastSyncedAtMs: number;
  readonly pendingCount: number;
  readonly devices: readonly SyncDeviceSummary[];
  readonly activeTicket: PairingTicket | null;
  readonly ticketStatus: PairingTicketStatus | null;
  readonly lastClaimedDevice: ClaimedDeviceInfo | null;
  readonly errorMessage: string;
  readonly errorCode: string;
  readonly revokedNotice: boolean;
}

export interface SyncTransport {
  pairCreate(params: {
    token?: string;
    deviceName: string;
    platform: SyncPlatform;
  }): Promise<PairingTicket>;
  pairStatus(params: { token: string; code: string }): Promise<PairingStatusResult>;
  pairClaim(params: {
    code: string;
    deviceName: string;
    platform: SyncPlatform;
  }): Promise<ClaimPairResult>;
  push(params: { token: string; payload: SyncPushRequest }): Promise<SyncPushResult>;
  pull(params: { token: string; sinceSeq: number }): Promise<SyncPullResult>;
  listDevices(params: { token: string }): Promise<{
    serverTimeMs: number;
    devices: readonly SyncDeviceSummary[];
  }>;
  renameSelf(params: { token: string; deviceName: string }): Promise<{
    serverTimeMs: number;
    device: SyncDeviceSummary;
  }>;
  revokeDevice(params: { token: string; deviceId: string }): Promise<{
    serverTimeMs: number;
    revokedDeviceId: string;
  }>;
}

export interface SyncProgressBridge {
  readRecord(lessonId: string): LessonLearningRecord;
  readAllNonEmptyRecords(): LessonLearningRecord[];
  lastOpenedLessonId(): string;
  applyRemoteSync(params: {
    lessons: readonly SyncLessonPullOutput[];
    lastOpened: SyncLastOpenedOutput | null;
  }): boolean;
}

/** 校验 4 位课程 ID 是否属于标准 335 课集合（0001..0120 及 0151..0365，排除 0121..0150）。 */
export function isValidCanonicalLessonId(id: string): boolean {
  if (typeof id !== 'string' || !/^\d{4}$/.test(id)) {
    return false;
  }
  const num = Number(id);
  return (num >= 1 && num <= 120) || (num >= 151 && num <= 365);
}

/** 提取 `epsync://v1/pair?c=XXXXXXXX` 中的查询参数 `c`（纯字符串解析，不依赖 URL 全局对象）。 */
function extractPairingCodeFromUri(uri: string): string | null {
  const qIndex = uri.indexOf('?');
  const pathPart = (qIndex >= 0 ? uri.slice(0, qIndex) : uri).toLowerCase();
  if (pathPart !== 'epsync://v1/pair' && pathPart !== 'epsync://v1/pair/') {
    return null;
  }
  if (qIndex < 0) {
    return null;
  }
  const query = uri.slice(qIndex + 1);
  for (const part of query.split('&')) {
    const eq = part.indexOf('=');
    const key = (eq >= 0 ? part.slice(0, eq) : part).trim().toLowerCase();
    if (key === 'c') {
      const val = eq >= 0 ? part.slice(eq + 1) : '';
      try {
        return decodeURIComponent(val.replace(/\+/g, ' '));
      } catch {
        return val;
      }
    }
  }
  return null;
}

/**
 * 归一化设备配对码：支持原始 8 位码、含连字符/空格、小写及 `epsync://v1/pair?c=...` URI。
 */
export function normalizePairingCode(raw: string): string | null {
  if (typeof raw !== 'string') {
    return null;
  }
  let s = raw.trim();
  if (!s) {
    return null;
  }
  if (s.toLowerCase().startsWith('epsync://')) {
    const extracted = extractPairingCodeFromUri(s);
    if (!extracted) {
      return null;
    }
    s = extracted.trim();
  }

  let out = '';
  for (let i = 0; i < s.length; i += 1) {
    let ch = s[i];
    if (ch === '-' || ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      continue;
    }
    if (ch >= 'a' && ch <= 'z') {
      ch = ch.toUpperCase();
    }
    if (!PAIRING_CHAR_SET.has(ch)) {
      return null;
    }
    out += ch;
  }
  return out.length === PAIRING_CODE_LENGTH ? out : null;
}

export function formatDisplayCode(code: string): string {
  const clean = normalizePairingCode(code);
  if (!clean) {
    return code;
  }
  return `${clean.slice(0, 4)}-${clean.slice(4)}`;
}

/** 用于输入框实时过滤与自动分段 `XXXX-XXXX`。 */
export function formatCodeInput(raw: string): string {
  if (typeof raw !== 'string') {
    return '';
  }
  const trimmed = raw.trim();
  if (trimmed.toLowerCase().startsWith('epsync://')) {
    const normalized = normalizePairingCode(trimmed);
    if (normalized) {
      return formatDisplayCode(normalized);
    }
  }
  let clean = '';
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i].toUpperCase();
    if (PAIRING_CHAR_SET.has(ch)) {
      clean += ch;
      if (clean.length >= PAIRING_CODE_LENGTH) {
        break;
      }
    }
  }
  return clean.length > 4 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean;
}

export function buildQrPayload(code: string): string {
  const normalized = normalizePairingCode(code) ?? code.trim().toUpperCase();
  return `epsync://v1/pair?c=${normalized}`;
}

/** 清理设备名称：剥离控制字符和 HTML 符号，压缩空白并截断至 32 个字符。 */
export function sanitizeDeviceName(raw: string, fallback = '微信小程序'): string {
  if (typeof raw !== 'string') {
    return fallback;
  }
  let filtered = '';
  for (let i = 0; i < raw.length; i += 1) {
    const code = raw.charCodeAt(i);
    const ch = raw[i];
    if (code < 32 || code === 127) {
      continue;
    }
    if (ch === '<' || ch === '>' || ch === '&' || ch === '"' || ch === "'") {
      continue;
    }
    filtered += ch;
  }
  const collapsed = filtered.trim().replace(/\s+/g, ' ');
  if (!collapsed) {
    return fallback;
  }
  return Array.from(collapsed).slice(0, 32).join('').trim() || fallback;
}

export function createEmptyPersistedState(defaultDeviceName = '微信小程序'): PersistedSyncState {
  return {
    schemaVersion: SYNC_SCHEMA_VERSION,
    groupId: '',
    deviceId: '',
    deviceToken: '',
    deviceName: sanitizeDeviceName(defaultDeviceName),
    lastSyncedSeq: 0,
    lastSyncedAtMs: 0,
    clockOffsetMs: 0,
    trackBaseSeq: {},
    lastOpenedSeq: 0,
    dirtyLessonIds: [],
    dirtyLastOpened: false,
    devices: [],
  };
}

export function trackBaseKey(lessonId: string, track: AudioTrackKey): string {
  return `${lessonId}:${track}`;
}

export function mapSyncErrorMessage(err: unknown): { code: string; message: string } {
  if (err instanceof SyncApiError) {
    switch (err.code) {
      case 'SYNC_NOT_CONFIGURED':
        return { code: err.code, message: '云端同步服务尚未配置，暂不可连接' };
      case 'CODE_NOT_FOUND':
      case 'INVALID_CODE':
        return { code: err.code, message: '配对码无效或不存在，请核对后重试' };
      case 'CODE_EXPIRED':
        return { code: err.code, message: '配对码已过期，请在另一台设备重新生成' };
      case 'CODE_USED':
        return { code: err.code, message: '该配对码已被使用，请重新生成' };
      case 'GROUP_FULL':
        return { code: err.code, message: '当前同步组已达 10 台设备上限，请先移除闲置设备' };
      case 'DEVICE_REVOKED':
      case 'UNAUTHORIZED':
        return { code: err.code, message: '该设备已不在当前同步组中，本地进度已保留' };
      case 'RATE_LIMITED':
        return {
          code: err.code,
          message: err.retryAfterSec
            ? `操作过于频繁，请 ${err.retryAfterSec} 秒后再试`
            : '操作过于频繁，请稍后再试',
        };
      case 'UPSTREAM_TIMEOUT':
      case 'UPSTREAM_UNREACHABLE':
        return { code: err.code, message: '无法连接同步服务器，已保留待同步记录' };
      default:
        return { code: err.code || 'SYNC_ERROR', message: err.message || '同步失败，请稍后重试' };
    }
  }
  const msg = err instanceof Error ? err.message : String(err);
  return { code: 'NETWORK_ERROR', message: msg || '网络连接异常，请稍后重试' };
}
