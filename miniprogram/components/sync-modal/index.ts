/**
 * ============================================================================
 *  多端设备同步弹窗组件（components/sync-modal/index.ts）
 * ============================================================================
 *  - 统一「移动设备」与「网页端」两大形态，不在「本机」下方区分系统子文案；
 *  - 保留双端光束流视觉，三节点升级为「本机 → 云端 → 其他设备」两段连续循环；
 *  - 支持 wx.scanCode 扫码直连（含拒绝相机权限降级提示）、8 位配对码（XXXX-XXXX）与设备管理。
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
  readonly isWeb: boolean;
  readonly lastSeenLabel: string;
  readonly isCurrent: boolean;
}

type ModalSubView = 'menu' | 'qr' | 'code';

interface ModalRuntime {
  unsubscribeSync?: () => void;
  countdownTimer?: ReturnType<typeof setInterval>;
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

function formatRelativeTime(ms: number): string {
  if (!ms || ms <= 0) return '尚未同步';
  const diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (diffSec < 60) return '刚刚已同步';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} 分钟前同步`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} 小时前同步`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay} 天前同步`;
}

function formatCountdown(expiresAtMs: number): string {
  const remainingSec = Math.max(0, Math.ceil((expiresAtMs - Date.now()) / 1000));
  const m = Math.floor(remainingSec / 60);
  const s = remainingSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function toDeviceViewModels(devices: readonly SyncDeviceSummary[]): DeviceViewModel[] {
  return devices.map((d) => {
    const isWeb = d.platform === 'web';
    return {
      deviceId: d.deviceId,
      deviceName: d.deviceName,
      platformLabel: isWeb ? '网页端' : '移动设备',
      isWeb,
      lastSeenLabel: formatRelativeTime(d.lastSeenAtMs),
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
    hasPeer: false,
    linkedVisual: false,
    linked: false,
    status: 'unlinked',
    beamChipText: '本机进度上传云端 · 自动分发到其他设备',
    deviceName: '当前设备',
    deviceCount: 0,
    devices: [] as DeviceViewModel[],
    subView: 'menu' as ModalSubView,
    displayCode: '',
    qrPayload: '',
    qrSizePx: 148,
    countdownText: '05:00',
    ticketStatus: '',
    codeInput: '',
    codeReady: false,
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
        codeReady: false,
        busy: false,
        renaming: false,
        errorMessage: '',
      });

      const snap = syncService.getSnapshot();
      this.applySnapshot(snap);
      if (snap.linked) {
        void syncService.refreshDevices();
      }
    },

    handleCloseCleanup(): void {
      const rt = getModalRuntime(this);
      this.clearCountdownTimer();
      this.clearQrRetryTimer();
      rt.unsubscribeSync?.();
      rt.unsubscribeSync = undefined;
      syncService.cancelPairingPoll();
      rt.lastDrawnQrPayload = '';
    },

    computeBeamChipText(
      snap: SyncEngineSnapshot,
      subView: ModalSubView,
      deviceCount: number,
    ): string {
      if (subView === 'qr' && snap.status !== 'offline' && snap.status !== 'error') {
        return '等待其他设备连接 · 配对后自动云端同步';
      }
      if (snap.status === 'offline') {
        return '网络离线 · 本机进度已本地保存，联网后自动上传';
      }
      if (snap.status === 'error') {
        return '同步暂未完成 · 稍后自动重试';
      }
      if (snap.status === 'syncing') {
        return '本机进度上传云端 · 正在分发到其他设备…';
      }
      if (snap.linked && deviceCount > 1) {
        return `已完成 ${this.data.completedCount} / ${this.data.totalCount} 课 · ${deviceCount} 台设备通过云端实时同步`;
      }
      return '本机进度上传云端 · 自动分发到其他设备';
    },

    applySnapshot(snap: SyncEngineSnapshot): void {
      const devices = toDeviceViewModels(snap.devices);
      const hasPeer = devices.some((d) => !d.isCurrent) || devices.length > 1;
      let nextSubView: ModalSubView = this.data.subView;

      if (snap.ticketStatus === 'consumed' && nextSubView === 'qr') {
        nextSubView = 'menu';
        wx.showToast({
          title: snap.lastClaimedDevice?.deviceName
            ? `已连接 ${snap.lastClaimedDevice.deviceName}`
            : '新设备已加入，进度已同步',
          icon: 'success',
        });
      }

      const linkedVisual =
        snap.linked &&
        hasPeer &&
        nextSubView !== 'qr' &&
        snap.status !== 'offline' &&
        snap.status !== 'error';

      const patch: Record<string, unknown> = {
        subView: nextSubView,
        linked: snap.linked,
        hasPeer,
        linkedVisual,
        status: snap.status,
        beamChipText: this.computeBeamChipText(snap, nextSubView, devices.length),
        deviceName: snap.deviceName || '当前设备',
        deviceCount: devices.length,
        devices,
        errorMessage: snap.errorMessage,
        revokedNotice: snap.revokedNotice,
        ticketStatus: snap.ticketStatus ?? '',
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

      this.setData(patch);

      if (this.data.visible && nextSubView === 'qr' && snap.activeTicket?.qrPayload) {
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
          if (msg.includes('auth deny') || msg.includes('authorize')) {
            wx.showModal({
              title: '未获得相机权限',
              content: '您可在系统设置或右上角权限设置中开启相机权限，或直接在此手动输入 8 位配对码。',
              showCancel: false,
              confirmText: '去手动输入',
            });
            return;
          }
          this.setData({ errorMessage: '未能打开相机扫码，请在下方手动输入 8 位配对码' });
        },
      });
    },

    onGenerateCode(): void {
      if (this.data.busy) return;
      const snap = syncService.getSnapshot();
      this.setData({
        subView: 'qr',
        busy: true,
        errorMessage: '',
        linkedVisual: false,
        beamChipText: this.computeBeamChipText(snap, 'qr', this.data.deviceCount),
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
      const snap = syncService.getSnapshot();
      const linkedVisual =
        snap.linked &&
        this.data.hasPeer &&
        snap.status !== 'offline' &&
        snap.status !== 'error';
      this.setData({
        subView: 'menu',
        codeInput: '',
        codeReady: false,
        errorMessage: '',
        linkedVisual,
        beamChipText: this.computeBeamChipText(snap, 'menu', this.data.deviceCount),
      });
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
      const snap = syncService.getSnapshot();
      this.setData({
        subView: 'code',
        codeInput: '',
        codeReady: false,
        errorMessage: '',
        linkedVisual: false,
        beamChipText: this.computeBeamChipText(snap, 'code', this.data.deviceCount),
      });
    },

    onCodeInput(event: WechatMiniprogram.Input): void {
      const formatted = formatCodeInput(event.detail.value || '');
      const cleanLen = formatted.replace(/[^A-Z0-9]/g, '').length;
      this.setData({
        codeInput: formatted,
        codeReady: cleanLen === 8,
      });
    },

    onSubmitCode(): void {
      if (this.data.busy) return;
      const code = normalizePairingCode(this.data.codeInput);
      if (!code) {
        this.setData({ errorMessage: '请输入完整的 8 位配对码（如 K7M9-P2XR）' });
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
            this.setData({ subView: 'menu', codeInput: '', codeReady: false });
            wx.showToast({ title: '已加入同步组，进度已合并', icon: 'success' });
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
            wx.showToast({ title: '已完成双向同步', icon: 'success' });
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
        title: '退出同步组',
        content: '仅解除多端同步关系，本机已学进度不会丢失。确认退出？',
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

    clearQrRetryTimer(): void {
      const rt = getModalRuntime(this);
      if (rt.qrRetryTimer) {
        clearTimeout(rt.qrRetryTimer);
        rt.qrRetryTimer = undefined;
      }
    },
  },
});
