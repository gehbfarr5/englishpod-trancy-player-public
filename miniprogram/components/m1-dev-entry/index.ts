interface M1EntryData {
  visible: boolean;
}

Component<M1EntryData>({
  data: {
    visible: false,
  },

  lifetimes: {
    attached() {
      try {
        const envVersion = wx.getAccountInfoSync().miniProgram.envVersion;
        this.setData({ visible: envVersion === 'develop' || envVersion === 'trial' });
      } catch {
        this.setData({ visible: false });
      }
    },
  },

  methods: {
    openExperiment() {
      if (!this.data.visible) return;
      wx.navigateTo({ url: '/pages/m1Experiment/index' });
    },
  },
});
