/**
 * ============================================================================
 *  课程属性解析（core/lessonAttributes.ts —— 纯 TypeScript，零平台依赖）
 * ============================================================================
 *  为课程库首页聚光灯卡（Continue Card）提供课程属性展示文案。
 *  例如：
 *    - Difficult Customer (B0001, Elementary)  → "Elementary · Daily Life"
 *    - Hotel Upgrade (C0003, Daily Life)       → "Intermediate · Daily Life"
 *    - Virus! (C0007, The Office)              → "Intermediate · The Office"
 *    - Protest! (D0018, Upper)                 → "Upper Intermediate · Global View"
 * ============================================================================
 */

/**
 * 依据课程编号 code 前缀与 level 字段解析规范的难度等级。
 * - B 前缀: Elementary
 * - C 前缀: Intermediate
 * - D 前缀: Upper Intermediate
 * - E 前缀: Advanced
 * - F 前缀: Advanced Media
 */
export function resolveLessonDifficulty(code?: string, level?: string): string {
  const prefix = (code || '')[0]?.toUpperCase();
  if (prefix === 'B') return 'Elementary';
  if (prefix === 'C') return 'Intermediate';
  if (prefix === 'D') return 'Upper Intermediate';
  if (prefix === 'E') return 'Advanced';
  if (prefix === 'F') return 'Advanced Media';

  if (level) {
    if (level === 'Upper') return 'Upper Intermediate';
    if (['Elementary', 'Intermediate', 'Advanced', 'Advanced Media'].includes(level)) {
      return level;
    }
  }

  return 'Elementary';
}

/**
 * 依据标题分隔符与 level 字段解析课程场景/分类。
 * 例如：
 *   - "Daily Life - Cut In Line" → "Daily Life"
 *   - "The Weekend - Road Trip"  → "The Weekend"
 *   - level 为 "Daily Life" / "The Office" / "The Weekend" / "Global View" → 该分类
 *   - 其余默认回退为 "Daily Life"
 */
export function resolveLessonTopic(title?: string, level?: string): string {
  if (title && title.includes(' - ')) {
    const candidate = title.split(' - ')[0].trim();
    if (candidate) return candidate;
  }

  if (level && ['Daily Life', 'The Office', 'The Weekend', 'Global View'].includes(level)) {
    return level;
  }

  return 'Daily Life';
}

/**
 * 格式化课程展示属性（如 "Elementary · Daily Life"）。
 */
export function formatLessonAttributes(item: {
  code?: string;
  level?: string;
  title?: string;
}): string {
  const diff = resolveLessonDifficulty(item.code, item.level);
  const topic = resolveLessonTopic(item.title, item.level);

  if (diff === topic) {
    return diff;
  }

  return `${diff} · ${topic}`;
}
