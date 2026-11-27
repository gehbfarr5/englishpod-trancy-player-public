import { common } from '@kit.AbilityKit';
import { preferences, relationalStore } from '@kit.ArkData';
import { AppThemePreference, LessonProgressRecord, TrackType } from '../models/LessonModels';

export interface AppSettingsSnapshot {
  lastOpenedLessonId: string;
  themePreference: AppThemePreference;
  playbackSpeed: number;
  spatialAudioEnabled: boolean;
  autoNextEnabled: boolean;
  dailyReminderEnabled: boolean;
  dailyReminderHour: number;
  dailyReminderMinute: number;
}

const DEFAULT_SETTINGS: AppSettingsSnapshot = {
  lastOpenedLessonId: '0001',
  themePreference: AppThemePreference.SYSTEM,
  playbackSpeed: 1.0,
  spatialAudioEnabled: false,
  autoNextEnabled: true,
  dailyReminderEnabled: false,
  dailyReminderHour: 21,
  dailyReminderMinute: 0
};

export class ProgressRepository {
  private rdbStore?: relationalStore.RdbStore;
  private prefs?: preferences.Preferences;

  async init(context: common.Context): Promise<void> {
    const storeConfig: relationalStore.StoreConfig = {
      name: 'englishpod_progress_v2.db',
      securityLevel: relationalStore.SecurityLevel.S1
    };
    this.rdbStore = await relationalStore.getRdbStore(context, storeConfig);
    await this.rdbStore.executeSql(
      `CREATE TABLE IF NOT EXISTS lesson_progress_v2 (
        lesson_id TEXT PRIMARY KEY,
        saved_pb_sec REAL DEFAULT 0,
        saved_dg_sec REAL DEFAULT 0,
        pb_seg_idx INTEGER DEFAULT 0,
        dg_seg_idx INTEGER DEFAULT 0,
        last_track TEXT DEFAULT 'pb',
        pb_duration_sec REAL DEFAULT 0,
        dg_duration_sec REAL DEFAULT 0,
        progress_pct INTEGER DEFAULT 0,
        is_completed INTEGER DEFAULT 0,
        has_started INTEGER DEFAULT 0,
        updated_at_ms INTEGER DEFAULT 0
      )`
    );
    this.prefs = await preferences.getPreferences(context, 'englishpod_settings_v2');
  }

  async loadAllProgress(): Promise<Map<string, LessonProgressRecord>> {
    const map = new Map<string, LessonProgressRecord>();
    if (!this.rdbStore) {
      return map;
    }
    const predicates = new relationalStore.RdbPredicates('lesson_progress_v2');
    const rs = await this.rdbStore.query(predicates);
    try {
      while (rs.goToNextRow()) {
        const rawTrack = rs.getString(rs.getColumnIndex('last_track'));
        const lastTrack: TrackType = rawTrack === 'dg' ? 'dg' : 'pb';
        const rec: LessonProgressRecord = {
          lessonId: rs.getString(rs.getColumnIndex('lesson_id')),
          savedPbSec: rs.getDouble(rs.getColumnIndex('saved_pb_sec')),
          savedDgSec: rs.getDouble(rs.getColumnIndex('saved_dg_sec')),
          pbSegIdx: rs.getLong(rs.getColumnIndex('pb_seg_idx')),
          dgSegIdx: rs.getLong(rs.getColumnIndex('dg_seg_idx')),
          lastTrack,
          pbDurationSec: rs.getDouble(rs.getColumnIndex('pb_duration_sec')),
          dgDurationSec: rs.getDouble(rs.getColumnIndex('dg_duration_sec')),
          progressPct: rs.getLong(rs.getColumnIndex('progress_pct')),
          isCompleted: rs.getLong(rs.getColumnIndex('is_completed')) === 1,
          hasStarted: rs.getLong(rs.getColumnIndex('has_started')) === 1,
          updatedAtMs: rs.getLong(rs.getColumnIndex('updated_at_ms'))
        };
        map.set(rec.lessonId, rec);
      }
    } finally {
      rs.close();
    }
    return map;
  }

  async upsertProgress(rec: LessonProgressRecord): Promise<void> {
    if (!this.rdbStore) {
      return;
    }
    const bucket: relationalStore.ValuesBucket = {
      lesson_id: rec.lessonId,
      saved_pb_sec: rec.savedPbSec,
      saved_dg_sec: rec.savedDgSec,
      pb_seg_idx: rec.pbSegIdx,
      dg_seg_idx: rec.dgSegIdx,
      last_track: rec.lastTrack,
      pb_duration_sec: rec.pbDurationSec,
      dg_duration_sec: rec.dgDurationSec,
      progress_pct: rec.progressPct,
      is_completed: rec.isCompleted ? 1 : 0,
      has_started: rec.hasStarted ? 1 : 0,
      updated_at_ms: rec.updatedAtMs
    };
    await this.rdbStore.insert(
      'lesson_progress_v2',
      bucket,
      relationalStore.ConflictResolution.ON_CONFLICT_REPLACE
    );
  }

  async loadSettings(): Promise<AppSettingsSnapshot> {
    if (!this.prefs) {
      return {
        lastOpenedLessonId: DEFAULT_SETTINGS.lastOpenedLessonId,
        themePreference: DEFAULT_SETTINGS.themePreference,
        playbackSpeed: DEFAULT_SETTINGS.playbackSpeed,
        spatialAudioEnabled: DEFAULT_SETTINGS.spatialAudioEnabled,
        autoNextEnabled: DEFAULT_SETTINGS.autoNextEnabled,
        dailyReminderEnabled: DEFAULT_SETTINGS.dailyReminderEnabled,
        dailyReminderHour: DEFAULT_SETTINGS.dailyReminderHour,
        dailyReminderMinute: DEFAULT_SETTINGS.dailyReminderMinute
      };
    }
    const themeStr = (await this.prefs.get('themePreference', AppThemePreference.SYSTEM)) as string;
    return {
      lastOpenedLessonId: (await this.prefs.get('lastOpenedLessonId', '0001')) as string,
      themePreference: (themeStr as AppThemePreference) ?? AppThemePreference.SYSTEM,
      playbackSpeed: (await this.prefs.get('playbackSpeed', 1.0)) as number,
      spatialAudioEnabled: (await this.prefs.get('spatialAudioEnabled', false)) as boolean,
      autoNextEnabled: (await this.prefs.get('autoNextEnabled', true)) as boolean,
      dailyReminderEnabled: (await this.prefs.get('dailyReminderEnabled', false)) as boolean,
      dailyReminderHour: (await this.prefs.get('dailyReminderHour', 21)) as number,
      dailyReminderMinute: (await this.prefs.get('dailyReminderMinute', 0)) as number
    };
  }

  async saveSetting(key: string, value: preferences.ValueType): Promise<void> {
    if (!this.prefs) {
      return;
    }
    await this.prefs.put(key, value);
    await this.prefs.flush();
  }
}
