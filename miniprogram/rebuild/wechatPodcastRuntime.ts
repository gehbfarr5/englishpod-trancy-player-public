import { WechatCloudAdapter } from '../adapters/wechat/cloud';
import { resolvePlayableUrl } from '../adapters/wechat/cloudAudioUrl';
import { progressJournal } from '../services/progressJournal';
import { PodcastCourse, PodcastEvent, PodcastPort, PodcastSession } from './podcastSession';
import { LessonDetail, LessonIndexItem } from '../core/types';

let runtime: Promise<PodcastRuntime> | null = null;
export interface PodcastRuntime {
  session: PodcastSession;
  index: LessonIndexItem[];
  detail(id: string): Promise<LessonDetail>;
}
/** Exactly one M2 owner per process. No page lifecycle creates a second audio engine. */
export function getPodcastRuntime(): Promise<PodcastRuntime> {
  if (!runtime) runtime = createRuntime().catch(error => { runtime = null; throw error; });
  return runtime;
}
async function createRuntime(): Promise<PodcastRuntime> {
  const cloud = new WechatCloudAdapter();
  const index = await cloud.getLessonIndex();
  if (!index.length) throw new Error('No courses available');
  const manager = wx.getBackgroundAudioManager();
  if (manager.src) throw new Error('Please close the old player and relaunch this development build.');
  const details = new Map<string, LessonDetail>();
  const detail = async (id: string) => {
    let value = details.get(id);
    if (!value) { value = await cloud.getLessonDetail(id); details.set(id, value); }
    return value;
  };
  let generation = 0;
  let source = '';
  let session: PodcastSession;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let checkpoint: ReturnType<typeof setInterval> | undefined;
  const clearWatchdog = () => { if (watchdog) clearTimeout(watchdog); watchdog = undefined; };
  const stopCheckpoint = () => { if (checkpoint) clearInterval(checkpoint); checkpoint = undefined; };
  const startCheckpoint = () => {
    stopCheckpoint();
    checkpoint = setInterval(() => {
      if (!manager.paused && manager.src === source) void session.event('time', generation);
    }, 3000);
  };
  const port: PodcastPort = {
    snapshot: () => ({ positionMs: (manager.currentTime || 0) * 1000,
      durationMs: (manager.duration || 0) * 1000, playing: !manager.paused }),
    load: (course: PodcastCourse, startMs: number, nextGeneration: number) => {
      generation = nextGeneration; source = course.source;
      manager.title = course.title; manager.epname = 'EnglishPod'; manager.singer = 'EnglishPod';
      manager.startTime = startMs / 1000;
      clearWatchdog(); stopCheckpoint();
      const requestedGeneration = generation;
      watchdog = setTimeout(() => {
        if (generation === requestedGeneration) void session.event('error', generation);
      }, 30000);
      manager.src = source;
    },
    play: () => manager.play(), pause: () => manager.pause(), seek: ms => manager.seek(ms / 1000),
  };
  session = new PodcastSession(port, progressJournal, async id => {
    const value = await detail(id);
    const file = cloud.resolveAudioFileId(id, 'pb', value.audio.pb);
    if (!file) throw new Error('Podcast audio unavailable');
    return { id, title: value.title || id, source: await resolvePlayableUrl(file) };
  }, index.map(item => item.lessonId));
  const event = (kind: PodcastEvent) => {
    if (!source || manager.src !== source) return;
    void session.event(kind, generation);
  };
  manager.onCanplay(() => { clearWatchdog(); event('ready'); });
  manager.onTimeUpdate(() => event('time'));
  manager.onPlay(() => { startCheckpoint(); event('play'); });
  manager.onPause(() => { stopCheckpoint(); event('pause'); });
  manager.onEnded(() => { stopCheckpoint(); clearWatchdog(); event('ended'); });
  manager.onError(() => { stopCheckpoint(); clearWatchdog(); event('error'); });
  manager.onStop(() => { stopCheckpoint(); clearWatchdog(); session.pause(); });
  return {session, index, detail};
}
