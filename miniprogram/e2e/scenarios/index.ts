import { gestureScroll } from './gesture-scroll';
import { renderAnchor } from './render-anchor';
import { switchFirstFrame } from './switch-first-frame';
import { switchKeepPosition } from './switch-keep-position';
import { switchPaused } from './switch-paused';
import { switchRoundTrip } from './switch-roundtrip';
import type { Scenario } from '../scenario';

/**
 * 场景注册表。新增场景只需在此追加，`npm run e2e` 会自动纳入。
 *
 * 排序即执行顺序：把最能定位问题的放在前面，失败时先看到关键结论。
 */
export const scenarios: Scenario[] = [
  switchFirstFrame,
  switchPaused,
  switchRoundTrip,
  switchKeepPosition,
  renderAnchor,
  gestureScroll,
];
