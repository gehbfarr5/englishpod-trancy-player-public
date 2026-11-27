import { reminderAgentManager } from '@kit.BackgroundTasksKit';

/**
 * HarmonyOS 7.0 (API 26) Background Agent Reminder manager for daily EnglishPod
 * intensive listening check-ins (survives app termination).
 */
export class StudyReminderManager {
  private currentReminderId: number = -1;

  async scheduleDailyStudyReminder(hour: number, minute: number, lessonCode: string): Promise<number> {
    await this.cancelAll();
    try {
      const reminder: reminderAgentManager.ReminderRequestAlarm = {
        reminderType: reminderAgentManager.ReminderType.REMINDER_TYPE_ALARM,
        hour,
        minute,
        daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
        title: 'EnglishPod 每日精听打卡',
        content: `继续精听 ${lessonCode}，保持语感不中断`,
        snoozeTimes: 1,
        timeInterval: 5 * 60,
        wantAgent: {
          pkgName: 'com.jin.englishpod',
          abilityName: 'EntryAbility'
        }
      };
      this.currentReminderId = await reminderAgentManager.publishReminder(reminder);
      return this.currentReminderId;
    } catch {
      return -1;
    }
  }

  async cancelAll(): Promise<void> {
    try {
      await reminderAgentManager.cancelAllReminders();
    } catch {
      // Ignore
    } finally {
      this.currentReminderId = -1;
    }
  }
}
