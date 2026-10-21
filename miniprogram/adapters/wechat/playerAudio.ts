/**
 * ============================================================================
 *  播放器音频适配器工厂（adapters/wechat/playerAudio.ts）
 * ============================================================================
 *  按模式创建音频适配器，把「用哪个播放器」这一决策收敛到一处。
 *
 *  模式：
 *    - `'background'`（默认，M4）：`BackgroundAudioManager`。
 *      统一走 BAM → 后台播放 / 锁屏控制条 / 耳机按键 全部由它承载，
 *      且 **BAM 支持 `playbackRate`**，倍速与后台不冲突。
 *      取舍：避免「前台 InnerAudioContext ↔ 后台 BAM」的手动交接（交接会带来
 *      断音窗口与双播放风险）；代价是首次起播延迟略高于 InnerAudioContext。
 *    - `'foreground'`：`InnerAudioContext`。延迟更低，但**不支持后台播放**
 *      （切后台即停），仅作为可选降级/对比模式。
 *
 *  切换：修改下面的 `PLAYER_AUDIO_MODE` 常量即可，播放器页无需改动。
 * ============================================================================
 */

import { AudioAdapter } from '../../core/types';
import { WechatAudioAdapter } from './audio';
import { BackgroundAudioAdapter } from './backgroundAudio';

/** 播放器音频模式。 */
export type PlayerAudioMode = 'background' | 'foreground';

/**
 * 当前模式。
 *
 * 默认 `'background'`：M4 要求后台播放 + 锁屏 + 耳机按键，故统一用 BAM。
 */
export const PLAYER_AUDIO_MODE: PlayerAudioMode = 'background';

/** 按当前模式创建音频适配器。 */
export function createPlayerAudio(): AudioAdapter {
  return PLAYER_AUDIO_MODE === 'background'
    ? new BackgroundAudioAdapter()
    : new WechatAudioAdapter();
}
