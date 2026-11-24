/**
 * ============================================================================
 *  多端设备同步弹窗组件（components/sync-modal/index.ts）
 * ============================================================================
 *  - 双端光束流主视觉（Animated Beam 风格，纯 GPU CSS 动画，零逐帧 setData）；
 *  - 双主题设计令牌完全对齐 Warm Parchment / Dark Cocoon；
 *  - 支持 wx.scanCode 扫码直连、Canvas 2D 二维码生成与 8 位码展示、手动输入配对码、
 *    设备列表管理（重命名/移除/手动同步/退出同步组）。
 * ============================================================================
 */

import { generateQrMatrix } from '../../core/qrMatrix';
import {
  SyncDeviceSummary,
  SyncEngineSnapshot,
  formatCodeInput,
  normalizePairingCode,
} from '../../core/syncModels';
import { syncService } from '../../services/syncService';

interface DeviceViewModel {
  readonly deviceId: string;
  readonly deviceName: string;
  readonly platformLabel: string;
  readonly platformShort: string;
  readonly lastSeenLabel: string;
  readonly isCurrent: boolean;
}

type ModalSubView = 'menu' | 'qr' | 'code';

interface ModalRuntime {
  unsubscribeSync?: () => void;
  countdownTimer?: ReturnType<typeof setInterval>;
  beamPulseTimer?: ReturnType<typeof setTimeout>;
  qrRetryTimer?: ReturnType<typeof setTimeout>;
  lastDrawnQrPayload: string;
}

const runtimeByInstance = new WeakMap<object, ModalRuntime>();

function getModalRuntime(instance: object): ModalRuntime {
  let rt = runtimeByInstance.get(instance);
  if (!rt) {
    rt = { lastDrawnQrPayload: '' };
    runtimeByInstance.set(instance, rt);
  }
  return rt;
}

const PLATFORM_LABELS: Record<string, { label: string; short: string }> = {
  ios: { label: 'iPhone', short: 'iOS' },
  ipad: { label: 'iPad', short: 'iPad' },
  android: { label: 'Android', short: 'AND' },
  web: { label: 'Web / 车机', short: 'WEB' },
  wechat: { label: '微信小程序', short: '微信' },
  harmonyos: { label: 'HarmonyOS', short: 'HM' },
};

function formatRelativeTime(ms: number): string {
  if (!ms || ms <= 0) return '尚未同步';
  const diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (diffSec < 15) return '刚刚';
  if (diffSec < 60) return `${diffSec} 秒前`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} 小时前`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay} 天前`;
}

function formatCountdown(expiresAtMs: number): string {
  const remainingSec = Math.max(0, Math.ceil((expiresAtMs - Date.now()) / 1000));
  const m = Math.floor(remainingSec / 60);
  const s = remainingSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function mapStatusText(snap: SyncEngineSnapshot): string {
  if (!snap.linked) return '本机独立记录';
  switch (snap.status) {
    case 'syncing':
      return '正在同步…';
    case 'offline':
      return snap.pendingCount > 0 ? `离线 · 待同步 ${snap.pendingCount} 项` : '网络离线';
    case 'error':
      return '同步异常';
    case 'synced':
    default:
      return '多端已连通';
  }
}

function toDeviceViewModels(devices: readonly SyncDeviceSummary[]): DeviceViewModel[] {
  return devices.map((d) => {
    const meta = PLATFORM_LABELS[d.platform] ?? { label: d.platform || '设备', short: 'DEV' };
    return {
      deviceId: d.deviceId,
      deviceName: d.deviceName,
      platformLabel: meta.label,
      platformShort: meta.short,
      lastSeenLabel: d.isCurrent ? '当前设备' : `最近活跃 ${formatRelativeTime(d.lastSeenAtMs)}`,
      isCurrent: d.isCurrent,
    };
  });
}

Component({
  properties: {
    visible: {
      type: Boolean,
      value: false,
      observer(nextVisible: boolean) {
        if (nextVisible) {
          this.handleOpen();
        } else {
          this.handleCloseCleanup();
        }
      },
    },
    completedCount: {
      type: Number,
      value: 0,
    },
    totalCount: {
      type: Number,
      value: 335,
    },
  },

  data: {
    beamPulsing: false,
    hasPeer: false,
    peerShort: '扫码',
    peerLabel: '待扫码接入',
    linked: false,
    status: 'unlinked',
    statusLabel: '本机独立记录',
    lastSyncLabel: '未连接其他设备',
    pendingCount: 0,
    deviceName: '微信小程序',
    deviceCount: 0,
    devices: [] as DeviceViewModel[],
    subView: 'menu' as ModalSubView,
    displayCode: '',
    qrPayload: '',
    qrSizePx: 156,
    countdownText: '05:00',
    ticketStatus: '',
    claimedDeviceName: '',
    codeInput: '',
    busy: false,
    errorMessage: '',
    revokedNotice: false,
    renaming: false,
    renameInput: '',
  },

  lifetimes: {
    detached() {
      this.handleCloseCleanup();
    },
  },

  methods: {
    handleOpen(): void {
      const rt = getModalRuntime(this);
      syncService.init();
      rt.unsubscribeSync?.();
      rt.unsubscribeSync = syncService.subscribe((snap) => {
        this.applySnapshot(snap);
      });

      this.setData({
        subView: 'menu',
        codeInput: '',
        busy: false,
        renaming: false,
        beamPulsing: false,
      });

      const snap = syncService.getSnapshot();
      this.applySnapshot(snap);
      if (snap.linked) {
        void syncService.refreshDevices();
      }

      this.triggerBeamPulse();
    },

    handleCloseCleanup(): void {
      const rt = getModalRuntime(this);
      this.clearBeamPulseTimer();
      this.clearCountdownTimer();
      this.clearQrRetryTimer();
      rt.unsubscribeSync?.();
      rt.unsubscribeSync = undefined;
      syncService.cancelPairingPoll();
      rt.lastDrawnQrPayload = '';
      if (this.data.beamPulsing) {
        this.setData({ beamPulsing: false });
      }
    },

    applySnapshot(snap: SyncEngineSnapshot): void {
      const devices = toDeviceViewModels(snap.devices);
      const peer = devices.find((d) => !d.isCurrent);
      const prevStatus = this.data.status;
      const patch: Record<string, unknown> = {
        linked: snap.linked,
        hasPeer: Boolean(peer),
        peerShort: peer ? peer.platformShort : '扫码',
        peerLabel: peer ? peer.deviceName : devices.length > 1 ? `${devices.length - 1} 台对端` : '待扫码接入',
        status: snap.status,
        statusLabel: mapStatusText(snap),
        lastSyncLabel: snap.linked
          ? snap.lastSyncedAtMs > 0
            ? `上次同步 ${formatRelativeTime(snap.lastSyncedAtMs)}`
            : '等待首次同步'
          : '扫码或输码即可联通多端',
        pendingCount: snap.pendingCount,
        deviceName: snap.deviceName,
        deviceCount: devices.length,
        devices,
        errorMessage: snap.errorMessage,
        revokedNotice: snap.revokedNotice,
        ticketStatus: snap.ticketStatus ?? '',
        claimedDeviceName: snap.lastClaimedDevice?.deviceName ?? '',
      };

      if (snap.activeTicket) {
        patch.displayCode = snap.activeTicket.displayCode;
        patch.qrPayload = snap.activeTicket.qrPayload;
        patch.countdownText = formatCountdown(snap.activeTicket.expiresAtMs);
        this.startCountdownTimer(snap.activeTicket.expiresAtMs);
      } else {
        patch.displayCode = '';
        patch.qrPayload = '';
        this.clearCountdownTimer();
      }

      if (snap.ticketStatus === 'consumed' && this.data.subView === 'qr') {
        patch.subView = 'menu';
        wx.showToast({
          title: snap.lastClaimedDevice?.deviceName
            ? `已连接 ${snap.lastClaimedDevice.deviceName}`
            : '新设备已加入同步组',
          icon: 'success',
        });
      }

      this.setData(patch);

      if (prevStatus !== snap.status && snap.status === 'synced') {
        this.triggerBeamPulse();
      }

      if (this.data.visible && this.data.subView === 'qr' && snap.activeTicket?.qrPayload) {
        this.scheduleDrawQr(snap.activeTicket.qrPayload);
      }
    },

    onClose(): void {
      if (this.data.busy) return;
      this.triggerEvent('close');
    },

    noop(): void {
      // 阻止事件穿透到底层列表
    },

    onPulseBeam(): void {
      this.triggerBeamPulse();
    },

    triggerBeamPulse(): void {
      const rt = getModalRuntime(this);
      this.clearBeamPulseTimer();
      this.setData({ beamPulsing: false });
      wx.nextTick(() => {
        if (!this.data.visible) return;
        this.setData({ beamPulsing: true });
        rt.beamPulseTimer = setTimeout(() => {
          rt.beamPulseTimer = undefined;
          if (this.data.beamPulsing) {
            this.setData({ beamPulsing: false });
          }
        }, 1200);
      });
    },

    onDismissNotice(): void {
      syncService.dismissRevokedNotice();
      syncService.clearError();
    },

    // -------------------------------------------------------------- 扫码/建码/输码

    onScanQr(): void {
      if (this.data.busy) return;
      wx.scanCode({
        onlyFromCamera: false,
        scanType: ['qrCode'],
        success: (res) => {
          const code = normalizePairingCode(res.result || '');
          if (!code) {
            this.setData({ errorMessage: '未识别到有效的 EnglishPod 同步二维码' });
            return;
          }
          void this.performClaimWithOptionalSwitchPrompt(code);
        },
        fail: (err) => {
          const msg = typeof err?.errMsg === 'string' ? err.errMsg : '';
          if (msg.includes('cancel')) return;
          this.setData({ errorMessage: '未能调起扫码，可改用「输入 8 位设备码」' });
        },
      });
    },

    onGenerateCode(): void {
      if (this.data.busy) return;
      this.setData({
        subView: 'qr',
        busy: true,
        errorMessage: '',
      });
      void syncService
        .createPairingCode()
        .then((ticket) => {
          if (ticket && this.data.visible && this.data.subView === 'qr') {
            this.scheduleDrawQr(ticket.qrPayload);
          }
        })
        .catch(() => undefined)
        .finally(() => {
          this.setData({ busy: false });
        });
    },

    onCancelSubView(): void {
      syncService.clearActiveTicket();
      syncService.clearError();
      getModalRuntime(this).lastDrawnQrPayload = '';
      this.setData({ subView: 'menu', codeInput: '' });
    },

    onCopyCode(): void {
      if (!this.data.displayCode) return;
      wx.setClipboardData({
        data: this.data.displayCode,
        success: () => {
          wx.showToast({ title: '配对码已复制', icon: 'success' });
        },
      });
    },

    onShowCodeInput(): void {
      syncService.clearActiveTicket();
      syncService.clearError();
      this.setData({ subView: 'code', codeInput: '' });
    },

    onCodeInput(event: WechatMiniprogram.Input): void {
      const formatted = formatCodeInput(event.detail.value || '');
      this.setData({ codeInput: formatted });
    },

    onSubmitCode(): void {
      if (this.data.busy) return;
      const code = normalizePairingCode(this.data.codeInput);
      if (!code) {
        this.setData({ errorMessage: '请输入完整的 8 位设备配对码' });
        return;
      }
      void this.performClaimWithOptionalSwitchPrompt(code);
    },

    async performClaimWithOptionalSwitchPrompt(normalizedCode: string): Promise<void> {
      const perform = async (): Promise<void> => {
        this.setData({ busy: true, errorMessage: '' });
        try {
          const ok = this.data.linked
            ? await syncService.switchGroupWithCode(normalizedCode)
            : await syncService.claimPairingCode(normalizedCode);
          if (ok) {
            this.setData({ subView: 'menu', codeInput: '' });
            wx.showToast({ title: '设备已联通并完成同步', icon: 'success' });
          }
        } finally {
          this.setData({ busy: false });
        }
      };

      if (!this.data.linked) {
        await perform();
        return;
      }

      wx.showModal({
        title: '切换到新的同步组？',
        content: '当前设备已连接其他同步组。加入新组后将断开原同步组，但本地学习进度会完整保留并合并。',
        confirmText: '确认切换',
        success: (res) => {
          if (res.confirm) {
            void perform();
          }
        },
      });
    },

    // -------------------------------------------------------------- 已连接管理

    onSyncNow(): void {
      if (this.data.busy || !this.data.linked) return;
      this.setData({ busy: true });
      void syncService
        .syncNow()
        .then((ok) => {
          if (ok) {
            wx.showToast({ title: '已同步最新进度', icon: 'success' });
          }
        })
        .finally(() => {
          this.setData({ busy: false });
        });
    },

    onStartRename(): void {
      this.setData({
        renaming: true,
        renameInput: this.data.deviceName,
      });
    },

    onRenameInput(event: WechatMiniprogram.Input): void {
      this.setData({ renameInput: event.detail.value || '' });
    },

    onCancelRename(): void {
      this.setData({ renaming: false, renameInput: '' });
    },

    onConfirmRename(): void {
      if (this.data.busy) return;
      this.setData({ busy: true });
      void syncService
        .renameSelf(this.data.renameInput)
        .then((ok) => {
          if (ok) {
            this.setData({ renaming: false });
            wx.showToast({ title: '设备名称已更新', icon: 'success' });
          }
        })
        .finally(() => {
          this.setData({ busy: false });
        });
    },

    onRemoveDevice(event: WechatMiniprogram.TouchEvent): void {
      const deviceId = String(event.currentTarget.dataset.id || '');
      const deviceName = String(event.currentTarget.dataset.name || '该设备');
      if (!deviceId || this.data.busy) return;

      wx.showModal({
        title: '移除设备',
        content: `确认将「${deviceName}」移出当前同步组吗？对方保留本地已有进度，但不再同步新进度。`,
        confirmText: '确认移除',
        confirmColor: '#D9534F',
        success: (res) => {
          if (!res.confirm) return;
          this.setData({ busy: true });
          void syncService
            .removeDevice(deviceId)
            .then((ok) => {
              if (ok) {
                wx.showToast({ title: '已移除设备', icon: 'success' });
              }
            })
            .finally(() => {
              this.setData({ busy: false });
            });
        },
      });
    },

    onLeaveGroup(): void {
      if (this.data.busy || !this.data.linked) return;
      wx.showModal({
        title: '退出当前同步组',
        content: '退出后本机将停止与其他设备同步进度，但已学习的全部课程进度与完成记录会 100% 保留在本机。',
        confirmText: '确认退出',
        confirmColor: '#D9534F',
        success: (res) => {
          if (!res.confirm) return;
          this.setData({ busy: true });
          void syncService
            .leaveGroup()
            .then(() => {
              this.setData({ subView: 'menu', renaming: false });
              wx.showToast({ title: '已退出同步组', icon: 'success' });
            })
            .finally(() => {
              this.setData({ busy: false });
            });
        },
      });
    },

    // -------------------------------------------------------------- 二维码绘制与倒计时

    scheduleDrawQr(payload: string): void {
      const rt = getModalRuntime(this);
      if (!payload || payload === rt.lastDrawnQrPayload) return;
      this.clearQrRetryTimer();
      wx.nextTick(() => {
        this.drawQrCanvas(payload, 0);
      });
    },

    drawQrCanvas(payload: string, attempt: number): void {
      if (!this.data.visible || this.data.subView !== 'qr') return;
      const rt = getModalRuntime(this);
      const qr = generateQrMatrix(payload);
      const query = this.createSelectorQuery();
      query
        .select('#syncQrCanvas')
        .fields({ node: true, size: true })
        .exec((res) => {
          const target = res && res[0] ? res[0] : null;
          if (!target || !target.node) {
            if (attempt < 3) {
              rt.qrRetryTimer = setTimeout(() => {
                rt.qrRetryTimer = undefined;
                this.drawQrCanvas(payload, attempt + 1);
              }, 60);
            }
            return;
          }

          const canvas = target.node as WechatMiniprogram.Canvas;
          const ctx = canvas.getContext('2d');
          if (!ctx) return;

          const width = target.width || this.data.qrSizePx;
          const height = target.height || this.data.qrSizePx;
          let dpr = 2;
          try {
            dpr = wx.getWindowInfo().pixelRatio || 2;
          } catch {
            dpr = 2;
          }

          canvas.width = Math.round(width * dpr);
          canvas.height = Math.round(height * dpr);
          ctx.scale(dpr, dpr);

          // 强制亮色静默区底板，保障深色/浅色主题均能被各类摄像头秒扫
          ctx.fillStyle = '#FAF8F5';
          ctx.fillRect(0, 0, width, height);

          const quietModules = 3;
          const totalModules = qr.size + quietModules * 2;
          const cell = Math.floor(Math.min(width, height) / totalModules);
          const gridSize = cell * qr.size;
          const offsetX = Math.floor((width - gridSize) / 2);
          const offsetY = Math.floor((height - gridSize) / 2);

          ctx.fillStyle = '#141413';
          for (let r = 0; r < qr.size; r += 1) {
            for (let c = 0; c < qr.size; c += 1) {
              if (qr.modules[r][c]) {
                ctx.fillRect(offsetX + c * cell, offsetY + r * cell, cell, cell);
              }
            }
          }

          rt.lastDrawnQrPayload = payload;
        });
    },

    startCountdownTimer(expiresAtMs: number): void {
      this.clearCountdownTimer();
      const rt = getModalRuntime(this);
      rt.countdownTimer = setInterval(() => {
        const text = formatCountdown(expiresAtMs);
        if (text !== this.data.countdownText) {
          this.setData({ countdownText: text });
        }
        if (expiresAtMs <= Date.now()) {
          this.clearCountdownTimer();
        }
      }, 1000);
    },

    clearCountdownTimer(): void {
      const rt = getModalRuntime(this);
      if (rt.countdownTimer) {
        clearInterval(rt.countdownTimer);
        rt.countdownTimer = undefined;
      }
    },

    clearBeamPulseTimer(): void {
      const rt = getModalRuntime(this);
      if (rt.beamPulseTimer) {
        clearTimeout(rt.beamPulseTimer);
        rt.beamPulseTimer = undefined;
      }
    },

    clearQrRetryTimer(): void {
      const rt = getModalRuntime(this);
      if (rt.qrRetryTimer) {
        clearTimeout(rt.qrRetryTimer);
        rt.qrRetryTimer = undefined;
      }
    },
  },
});
