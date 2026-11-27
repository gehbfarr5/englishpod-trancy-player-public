import { formBindingData, FormExtensionAbility, formInfo, formProvider } from '@kit.FormKit';
import { Want } from '@kit.AbilityKit';

interface StudyFormPayload {
  lessonCode: string;
  lessonTitle: string;
  progressPct: number;
  phraseIdx: number;
  phraseWord: string;
  phraseDef: string;
}

const DAILY_PHRASES: Array<[string, string]> = [
  ['still working on', 'not yet completed, need more time（仍在考虑中）'],
  ['would recommend', 'suggest politely（礼貌推荐）'],
  ['complimentary', 'given free of charge（免费赠送的）'],
  ['go with', 'to choose, pick（选择某样东西）'],
  ['grab', 'get quickly（快速拿/买点）']
];

export default class StudyFormAbility extends FormExtensionAbility {
  private phraseIdx: number = 0;

  onAddForm(want: Want): formBindingData.FormBindingData {
    return formBindingData.createFormBindingData(this.buildPayload());
  }

  onFormEvent(formId: string, message: string): void {
    try {
      const parsed = JSON.parse(message) as Record<string, string>;
      if (parsed['action'] === 'nextPhrase') {
        this.phraseIdx = (this.phraseIdx + 1) % DAILY_PHRASES.length;
        formProvider.updateForm(formId, formBindingData.createFormBindingData(this.buildPayload()));
      }
    } catch {
      // Ignore malformed event
    }
  }

  onAcquireFormState(want: Want): formInfo.FormState {
    return formInfo.FormState.READY;
  }

  private buildPayload(): StudyFormPayload {
    const pair = DAILY_PHRASES[this.phraseIdx];
    return {
      lessonCode: 'B0001',
      lessonTitle: 'Difficult Customer',
      progressPct: 36,
      phraseIdx: this.phraseIdx,
      phraseWord: pair[0],
      phraseDef: pair[1]
    };
  }
}
