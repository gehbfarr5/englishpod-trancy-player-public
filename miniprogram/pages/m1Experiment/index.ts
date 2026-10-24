import { WechatCloudAdapter } from '../../adapters/wechat/cloud';
import { resolvePlayableUrl } from '../../adapters/wechat/cloudAudioUrl';
import { playbackSession } from '../../services/playbackSession';
import {
  M1ContentView,
  M1ExperimentState,
  readM1ViewKey,
  SinglePodcastExperiment,
} from '../../rebuild/singlePodcastExperiment';
import { WechatM1BackgroundAudioPort } from '../../rebuild/wechatM1BackgroundAudioPort';
import { Segment, VocabEntry } from '../../core/types';

interface M1PageData {
  isBlocked: boolean;
  blockReason: string;
  isLoadingLesson: boolean;
  isStarting: boolean;
  canStart: boolean;
  lessonTitle: string;
  status: string;
  positionSec: number;
  durationSec: number;
  positionLabel: string;
  durationLabel: string;
  isPlaying: boolean;
  sourceLoaded: boolean;
  lastErrorCode: number;
  currentView: M1ContentView;
  viewButtons: Array<{ key: M1ContentView; label: string }>;
  pbSegments: Segment[];
  dgSegments: Segment[];
  vocabulary: VocabEntry[];
  commandSummary: string;
}

interface M1PageCustom {
  media?: WechatM1BackgroundAudioPort;
  experiment?: SinglePodcastExperiment;
  source?: string;

  initializeLesson(): Promise<void>;
  refreshState(): void;
  onStartPodcast(): void;
  onTogglePlayback(): void;
  onSeekChange(event: WechatMiniprogram.SliderChange): void;
  onSelectView(event: WechatMiniprogram.TouchEvent): void;
  onExitExperiment(): void;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '00:00';
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

function isNonReleaseEnvironment(): boolean {
  try {
    const envVersion = wx.getAccountInfoSync().miniProgram.envVersion;
    return envVersion === 'develop' || envVersion === 'trial';
  } catch {
    return false;
  }
}

Page<M1PageData, M1PageCustom>({
  data: {
    isBlocked: false,
    blockReason: '',
    isLoadingLesson: true,
    isStarting: false,
    canStart: false,
    lessonTitle: 'Lesson 0001',
    status: 'Preparing isolated M1 experiment…',
    positionSec: 0,
    durationSec: 0,
    positionLabel: '00:00',
    durationLabel: '00:00',
    isPlaying: false,
    sourceLoaded: false,
    lastErrorCode: 0,
    currentView: 'pb',
    viewButtons: [
      { key: 'pb', label: 'Podcast transcript' },
      { key: 'dg', label: 'Dialogue transcript' },
      { key: 'vocab', label: 'Vocabulary' },
    ],
    pbSegments: [],
    dgSegments: [],
    vocabulary: [],
    commandSummary: 'Audio commands: 0',
  },

  async onLoad() {
    if (!isNonReleaseEnvironment()) {
      this.setData({
        isBlocked: true,
        isLoadingLesson: false,
        blockReason: 'This experiment is available only in development or trial builds.',
        status: 'Unavailable in release',
      });
      wx.redirectTo({ url: '/pages/library/index' });
      return;
    }

    // BackgroundAudioManager is process-global. Never take over a source from
    // the established player; M1 can only start in a clean, cold session.
    const manager = wx.getBackgroundAudioManager();
    if (playbackSession.isSrcLoadedInProcess() || Boolean(manager.src)) {
      this.setData({
        isBlocked: true,
        isLoadingLesson: false,
        blockReason: 'Close the active player and relaunch the development build before starting M1.',
        status: 'Existing audio session detected',
      });
      return;
    }

    this.media = new WechatM1BackgroundAudioPort();
    this.experiment = new SinglePodcastExperiment(this.media);
    this.media.setObserver(() => this.refreshState());
    await this.initializeLesson();
  },

  onShow() {
    this.refreshState();
  },

  onUnload() {
    if (this.experiment?.state().playback.isPlaying) {
      this.experiment.pause();
    }
    this.media?.releaseObserver();
  },

  async initializeLesson(): Promise<void> {
    this.setData({ isLoadingLesson: true, status: 'Loading lesson 0001…' });
    try {
      const cloud = new WechatCloudAdapter();
      const index = await cloud.getLessonIndex();
      const lesson = index.find((item) => item.lessonId === '0001');
      if (!lesson) throw new Error('Lesson 0001 is not available in the course index.');

      const detail = await cloud.getLessonDetail('0001');
      const audioFileId = cloud.resolveAudioFileId('0001', 'pb', detail.audio.pb);
      if (!audioFileId) throw new Error('Podcast audio is unavailable for lesson 0001.');
      const source = await resolvePlayableUrl(audioFileId);

      this.source = source;
      this.setData({
        isLoadingLesson: false,
        canStart: true,
        lessonTitle: lesson.title || detail.title || 'Lesson 0001',
        pbSegments: detail.tracks.pb,
        dgSegments: detail.tracks.dg,
        vocabulary: detail.vocabulary,
        status: 'Ready. Tap “Play Podcast” to start the single audio session.',
      });
    } catch (error) {
      this.setData({
        isLoadingLesson: false,
        status: error instanceof Error ? error.message : 'Lesson data could not be loaded.',
      });
    }
  },

  refreshState(): void {
    if (!this.experiment) return;
    const state: M1ExperimentState = this.experiment.state();
    const commandTotal =
      state.commands.sourceLoads +
      state.commands.playRequests +
      state.commands.pauseRequests +
      state.commands.seeks;
    this.setData({
      positionSec: state.playback.positionSec,
      durationSec: state.playback.durationSec,
      positionLabel: formatTime(state.playback.positionSec),
      durationLabel: formatTime(state.playback.durationSec),
      isPlaying: state.playback.isPlaying,
      sourceLoaded: state.playback.sourceLoaded,
      lastErrorCode: this.media?.getLastErrorCode() || 0,
      currentView: state.view,
      commandSummary:
        `Audio commands: ${commandTotal} · loads ${state.commands.sourceLoads} · play ${state.commands.playRequests} · pause ${state.commands.pauseRequests} · seek ${state.commands.seeks} · views ${state.commands.viewSelections}`,
      status: this.media?.getLastErrorCode()
        ? `Audio error code ${this.media.getLastErrorCode()}`
        : state.playback.isPlaying
          ? 'Podcast playing'
          : state.playback.sourceLoaded
            ? 'Podcast paused or loading'
            : this.data.status,
    });
  },

  onStartPodcast(): void {
    if (!this.experiment || !this.source || this.data.isStarting) return;
    try {
      this.setData({ isStarting: true, status: 'Starting Podcast…' });
      // BackgroundAudioManager starts when src is assigned. Do not issue a
      // second play() command in the same user action.
      this.experiment.startPodcast(this.source, this.data.lessonTitle);
      this.setData({ isStarting: false, canStart: false });
      this.refreshState();
    } catch {
      this.setData({ isStarting: false, canStart: true, status: 'Podcast could not be started.' });
    }
  },

  onTogglePlayback(): void {
    if (!this.experiment || !this.data.sourceLoaded) return;
    if (this.data.isPlaying) this.experiment.pause();
    else this.experiment.play();
    this.refreshState();
  },

  onSeekChange(event: WechatMiniprogram.SliderChange): void {
    if (!this.experiment || !this.data.sourceLoaded) return;
    const target = Number(event.detail.value);
    if (!Number.isFinite(target)) return;
    this.experiment.seek(target);
    this.refreshState();
  },

  onSelectView(event: WechatMiniprogram.TouchEvent): void {
    // WXML bindtap passes a native tap event. data-key is exposed on
    // currentTarget.dataset; event.detail is reserved for custom-event payloads.
    const key = readM1ViewKey(event);
    if (!key) return;
    this.experiment?.selectView(key);
    this.refreshState();
  },

  onExitExperiment(): void {
    wx.navigateBack({ delta: 1 });
  },
});
