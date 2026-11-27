const formStorage = new LocalStorage();

@Entry(formStorage)
@Component
struct StudyFormCard {
  @LocalStorageProp('lessonCode') lessonCode: string = 'B0001';
  @LocalStorageProp('lessonTitle') lessonTitle: string = 'Difficult Customer';
  @LocalStorageProp('progressPct') progressPct: number = 36;
  @LocalStorageProp('phraseWord') phraseWord: string = 'still working on';
  @LocalStorageProp('phraseDef') phraseDef: string = 'not yet completed, need more time';

  build() {
    Row({ space: 10 }) {
      // Left Study Resume Column (visible in both 2x2 and 2x4)
      Column({ space: 6 }) {
        Row({ space: 6 }) {
          Text(this.lessonCode)
            .fontSize(11)
            .fontWeight(FontWeight.Bold)
            .fontColor('#1ED760')
            .padding({ left: 7, right: 7, top: 2, bottom: 2 })
            .backgroundColor('#291ED760')
            .borderRadius(999)
          Text(`${this.progressPct}%`)
            .fontSize(11)
            .fontColor('#88FFFFFF')
        }
        Text(this.lessonTitle)
          .fontSize(14)
          .fontWeight(FontWeight.Bold)
          .fontColor('#FFFFFF')
          .maxLines(2)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        Blank()
        Button('▶ 继续精听')
          .height(28)
          .fontSize(11)
          .fontWeight(FontWeight.Bold)
          .fontColor('#060608')
          .backgroundColor('#1ED760')
          .borderRadius(999)
          .onClick(() => {
            postCardAction(this, {
              action: 'router',
              abilityName: 'EntryAbility',
              params: { ep_action: 'resume' }
            });
          })
      }
      .layoutWeight(1)
      .height('100%')
      .alignItems(HorizontalAlign.Start)

      // Right Daily Expression Interactive Column (2x4)
      Column({ space: 6 }) {
        Row() {
          Text('今日表达')
            .fontSize(10)
            .fontColor('#88FFFFFF')
          Blank()
          Text('换一条 ↻')
            .fontSize(10)
            .fontWeight(FontWeight.Medium)
            .fontColor('#1ED760')
            .onClick(() => {
              postCardAction(this, {
                action: 'message',
                params: { action: 'nextPhrase' }
              });
            })
        }
        .width('100%')

        Text(this.phraseWord)
          .fontSize(14)
          .fontWeight(FontWeight.Bold)
          .fontColor('#FFFFFF')
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })

        Text(this.phraseDef)
          .fontSize(11)
          .fontColor('#B3FFFFFF')
          .maxLines(3)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      }
      .layoutWeight(1)
      .height('100%')
      .padding({ left: 10 })
      .border({ width: { left: 1 }, color: '#1FFFFFFF' })
      .alignItems(HorizontalAlign.Start)
    }
    .width('100%')
    .height('100%')
    .padding(14)
    .backgroundColor('#13151C')
    .borderRadius(20)
  }
}
