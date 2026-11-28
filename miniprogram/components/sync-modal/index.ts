/**
 * ============================================================================
 *  多端设备同步弹窗组件（components/sync-modal/index.ts）
 * ============================================================================
 *  - 移动端原生 Bottom Sheet：无右上角关闭按钮，支持点遮罩或下滑关闭；
 *  - 去掉重型光束动画与整窗滚动，一屏极简展示；
 *  - 方案 A 双向自由配对与智能合组：单机展码未扫不锁死界面，已入组仍可直接扫码合组。
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

type ModalSubView = 'home' | 'qr' | 'code';

interface ModalRuntime {
  unsubscribeSync?: () => void;
  countdownTimer?: ReturnType<typeof setInterval>;
  qrRetryTimer?: ReturnType<typeof setTimeout>;
  lastDrawnQrPayload: string;
  touchStartY: number | null;
  touchDeltaY: number;
}

const runtimeByInstance = new WeakMap<object, ModalRuntime>();

function getModalRuntime(instance: object): ModalRuntime {
  let rt = runtimeByInstance.get(instance);
  if (!rt) {
    rt = { lastDrawnQrPayload: '', touchStartY: null, touchDeltaY: 0 };
    runtimeByInstance.set(instance, rt);
  }
  return rt;
}

function formatRelativeTime(ms: number): string {
  if (!ms || ms <= 0) return '尚未同步';
  const diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (diffSec < 60) return '刚刚';
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

function buildCodeCells(clean: string): Array<{ char: string; filled: boolean; active: boolean }> {
  const focusIdx = Math.min(clean.length, 7);
  const cells: Array<{ char: string; filled: boolean; active: boolean }> = [];
  for (let i = 0; i < 8; i += 1) {
    const ch = clean[i] || '';
    cells.push({
      char: ch,
      filled: Boolean(ch),
      active: i === focusIdx,
    });
  }
  return cells;
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
    hasLinkedPeers: false,
    linked: false,
    status: 'unlinked',
    statusLabel: '未连接其他设备',
    deviceName: '微信小程序',
    deviceCount: 0,
    devices: [] as DeviceViewModel[],
    subView: 'home' as ModalSubView,
    displayCode: '',
    qrPayload: '',
    qrSizePx: 148,
    countdownText: '05:00',
    ticketExpired: false,
    codeInput: '',
    codeCells: buildCodeCells(''),
    codeReady: false,
    codeFocus: false,
    busy: false,
    errorMessage: '',
    revokedNotice: false,
    renaming: false,
    renameInput: '',
    dragOffsetPx: 0,
    dragging: false,
  },

  lifetimes: {
    detached() {
      this.handleCloseCleanup();
    },
  },

  methods: {
    handleOpen(): void {
      const rt = getModalRuntime(this);
      rt.touchStartY = null;
      rt.touchDeltaY = 0;
      syncService.init();
      rt.unsubscribeSync?.();
      rt.unsubscribeSync = syncService.subscribe((snap) => {
        this.applySnapshot(snap);
      });

      this.setData({
        subView: 'home',
        codeInput: '',
        codeCells: buildCodeCells(''),
        codeReady: false,
        codeFocus: false,
        busy: false,
        renaming: false,
        errorMessage: '',
        ticketExpired: false,
        dragOffsetPx: 0,
        dragging: false,
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
      rt.touchStartY = null;
      rt.touchDeltaY = 0;
    },

    computeStatusLabel(snap: SyncEngineSnapshot): string {
      if (snap.status === 'syncing') return '正在同步…';
      if (snap.status === 'offline') return '待同步 · 联网后自动上传';
      if (snap.status === 'error') return '同步暂未完成 · 稍后重试';
      return `已同步 · ${formatRelativeTime(snap.lastSyncedAtMs)}`;
    },

    applySnapshot(snap: SyncEngineSnapshot): void {
      const devices = toDeviceViewModels(snap.devices);
      const hasLinkedPeers = snap.hasLinkedPeers;
      let nextSubView: ModalSubView = this.data.subView;

      if (snap.ticketStatus === 'consumed' && nextSubView === 'qr') {
        nextSubView = 'home';
        wx.showToast({
          title: snap.lastClaimedDevice?.deviceName
            ? `已连接 ${snap.lastClaimedDevice.deviceName}`
            : '新设备已加入，进度已同步',
          icon: 'success',
        });
      }

      const ticketExpired =
        snap.ticketStatus === 'expired' ||
        (Boolean(snap.activeTicket) && snap.activeTicket!.expiresAtMs <= Date.now());

      const patch: Record<string, unknown> = {
        subView: nextSubView,
        linked: snap.linked,
        hasLinkedPeers,
        status: snap.status,
        statusLabel: this.computeStatusLabel(snap),
        deviceName: snap.deviceName || '微信小程序',
        deviceCount: devices.length,
        devices,
        errorMessage: snap.errorMessage,
        revokedNotice: snap.revokedNotice,
        ticketExpired,
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
      // 阻止点击事件穿透到底层列表
    },

    // -------------------------------------------------------------- 下滑关闭手势

    onSheetTouchStart(event: WechatMiniprogram.TouchEvent): void {
      if (this.data.busy) return;
      const touch = event.touches && event.touches[0];
      if (!touch) return;
      const rt = getModalRuntime(this);
      rt.touchStartY = touch.clientY;
      rt.touchDeltaY = 0;
    },

    onSheetTouchMove(event: WechatMiniprogram.TouchEvent): void {
      const rt = getModalRuntime(this);
      if (rt.touchStartY === null || this.data.busy) return;
      const touch = event.touches && event.touches[0];
      if (!touch) return;
      const dy = Math.max(0, Math.round(touch.clientY - rt.touchStartY));
      rt.touchDeltaY = dy;
      if (dy > 6) {
        this.setData({ dragging: true, dragOffsetPx: Math.min(dy, 360) });
      }
    },

    onSheetTouchEnd(): void {
      const rt = getModalRuntime(this);
      if (rt.touchStartY === null) return;
      const shouldClose = rt.touchDeltaY > 68;
      rt.touchStartY = null;
      rt.touchDeltaY = 0;
      if (shouldClose) {
        this.setData({ dragging: false, dragOffsetPx: 0 });
        this.onClose();
      } else if (this.data.dragging || this.data.dragOffsetPx > 0) {
        this.setData({ dragging: false, dragOffsetPx: 0 });
      }
    },

    onDismissNotice(): void {
      syncService.dismissRevokedNotice();
      syncService.clearError();
      this.setData({ errorMessage: '', revokedNotice: false });
    },

    // -------------------------------------------------------------- 扫码/展码/输码

    onScanQr(): void {
      if (this.data.busy) return;
      syncService.cancelPairingPoll();
      wx.scanCode({
        onlyFromCamera: false,
        scanType: ['qrCode'],
        success: (res) => {
          const code = normalizePairingCode(res.result || '');
          if (!code) {
            this.setData({ errorMessage: '未识别到有效的 EnglishPod 同步二维码' });
            return;
          }
          void this.performPlanAClaim(code);
        },
        fail: (err) => {
          const msg = typeof err?.errMsg === 'string' ? err.errMsg : '';
          if (msg.includes('cancel')) return;
          if (msg.includes('auth deny') || msg.includes('authorize')) {
            this.onShowCodeInput();
            this.setData({
              errorMessage: '未获得相机权限，可在此直接手动输入 8 位配对码。',
            });
            return;
          }
          this.onShowCodeInput();
          this.setData({ errorMessage: '未能打开相机扫码，请在下方手动输入 8 位配对码' });
        },
      });
    },

    onGenerateCode(): void {
      if (this.data.busy) return;
      this.setData({
        subView: 'qr',
        busy: true,
        errorMessage: '',
        ticketExpired: false,
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
      this.setData({
        subView: 'home',
        codeInput: '',
        codeCells: buildCodeCells(''),
        codeReady: false,
        codeFocus: false,
        errorMessage: '',
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
      this.setData({
        subView: 'code',
        codeInput: '',
        codeCells: buildCodeCells(''),
        codeReady: false,
        codeFocus: true,
        errorMessage: '',
      });
    },

    onFocusCodeInput(): void {
      this.setData({ codeFocus: true });
    },

    onCodeInput(event: WechatMiniprogram.Input): void {
      const formatted = formatCodeInput(event.detail.value || '');
      const clean = formatted.replace(/[^A-Z0-9]/g, '');
      this.setData({
        codeInput: formatted,
        codeCells: buildCodeCells(clean),
        codeReady: clean.length === 8,
      });
    },

    onSubmitCode(): void {
      if (this.data.busy || !this.data.codeReady) return;
      const code = normalizePairingCode(this.data.codeInput);
      if (!code) {
        this.setData({ errorMessage: '请输入完整的 8 位配对码（如 K7M9-P2XR）' });
        return;
      }
      void this.performPlanAClaim(code);
    },

    async performPlanAClaim(normalizedCode: string): Promise<void> {
      const wasMultiLinked = this.data.hasLinkedPeers;
      this.setData({ busy: true, errorMessage: '' });
      try {
        const ok = await syncService.claimPairingCode(normalizedCode);
        if (ok) {
          this.setData({
            subView: 'home',
            codeInput: '',
            codeCells: buildCodeCells(''),
            codeReady: false,
            codeFocus: false,
          });
          wx.showToast({
            title: wasMultiLinked ? '已智能合组并同步' : '已加入同步组',
            icon: 'success',
          });
        }
      } finally {
        this.setData({ busy: false });
      }
    },

    // -------------------------------------------------------------- 已连接管理

    onSyncNow(): void {
      if (this.data.busy || !this.data.linked) return;
      this.setData({ busy: true });
      void syncService
        .syncNow()
        .then((ok) => {
          if (ok) {
            void syncService.refreshDevices();
            wx.showToast({ title: '已完成双向同步', icon: 'success' });
          }
        })
        .finally(() => {
          this.setData({ busy: false });
        });
    },

    onOpenSelfMenu(): void {
      if (this.data.busy) return;
      wx.showActionSheet({
        itemList: ['重命名本机', '退出同步组'],
        success: (res) => {
          if (res.tapIndex === 0) {
            this.onStartRename();
          } else if (res.tapIndex === 1) {
            this.onLeaveGroup();
          }
        },
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
        title: `移除「${deviceName}」？`,
        content: '移除后该设备将断开同步，但对方本地已学进度会完整保留。',
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
              this.setData({ subView: 'home', renaming: false });
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
        const expired = expiresAtMs <= Date.now();
        if (text !== this.data.countdownText || expired !== this.data.ticketExpired) {
          this.setData({ countdownText: text, ticketExpired: expired });
        }
        if (expired) {
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
