/**
 * HarmonyOS 7.0 Xiaoyi Agent & A2A Atomic Skill Bridge.
 * Registers 4 atomic skills invocable via voice or Want intent:
 *  - resumeLastLesson
 *  - replayCurrentSentence
 *  - lookupLessonVocab
 *  - playLessonByTopic
 */
export interface AgentActionResult {
  skillName: string;
  success: boolean;
  spokenSummary: string;
  lessonId?: string;
}

export interface AgentSkillHandler {
  resumeLastLesson: () => Promise<AgentActionResult>;
  replayCurrentSentence: () => Promise<AgentActionResult>;
  lookupLessonVocab: (word: string) => Promise<AgentActionResult>;
  playLessonByTopic: (query: string) => Promise<AgentActionResult>;
}

export class XiaoyiAgentBridge {
  private handler?: AgentSkillHandler;

  registerHandler(handler: AgentSkillHandler): void {
    this.handler = handler;
  }

  async dispatchSkill(skillName: string, params: Record<string, string>): Promise<AgentActionResult> {
    if (!this.handler) {
      return {
        skillName,
        success: false,
        spokenSummary: 'EnglishPod 技能处理器尚未初始化'
      };
    }
    switch (skillName) {
      case 'resumeLastLesson':
        return this.handler.resumeLastLesson();
      case 'replayCurrentSentence':
        return this.handler.replayCurrentSentence();
      case 'lookupLessonVocab':
        return this.handler.lookupLessonVocab(params['word'] ?? '');
      case 'playLessonByTopic':
        return this.handler.playLessonByTopic(params['query'] ?? '');
      default:
        return {
          skillName,
          success: false,
          spokenSummary: `未识别的原子技能: ${skillName}`
        };
    }
  }
}
