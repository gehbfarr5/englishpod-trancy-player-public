import 'dart:async';
import 'dart:js_interop';
import 'dart:js_interop_unsafe';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';

import 'sync_platform_types.dart';

bool get isHarmonyHost {
  final base = Uri.base;
  return base.host == 'app.englishpod.local' ||
      base.queryParameters['epHost'] == 'harmonyos';
}

bool get syncIsWeb => !isHarmonyHost;

String detectSyncPlatform({double shortestSide = 0}) =>
    isHarmonyHost ? 'harmonyos' : 'web';

String defaultSyncDeviceName(String platform) =>
    platform == 'harmonyos' ? '移动设备' : '网页端';

ValueNotifier<HostSafeInsets>? _safeInsetsNotifier;
double _hostTopInset = 0.0;
double _hostBottomInset = 0.0;
bool _safeInsetListenersAttached = false;

double _sanitizeInset(double? v) {
  if (v == null || v.isNaN || !v.isFinite || v <= 0.0) return 0.0;
  return v.clamp(0.0, 120.0).toDouble();
}

HostSafeInsets _readCssSafeInsets() {
  try {
    final doc = globalContext.getProperty<JSObject?>('document'.toJS);
    final docEl = doc?.getProperty<JSObject?>('documentElement'.toJS);
    if (docEl == null) return (top: 0.0, bottom: 0.0);
    final cs = globalContext.callMethod<JSObject?>(
      'getComputedStyle'.toJS,
      docEl,
    );
    if (cs == null) return (top: 0.0, bottom: 0.0);
    double readProp(String prop) {
      final raw = cs.callMethod<JSString?>('getPropertyValue'.toJS, prop.toJS);
      final parsed = globalContext.callMethod<JSNumber?>(
        'parseFloat'.toJS,
        (raw?.toDart ?? '0').toJS,
      );
      return _sanitizeInset(parsed?.toDartDouble);
    }

    return (top: readProp('--ep-sat'), bottom: readProp('--ep-sab'));
  } catch (_) {
    return (top: 0.0, bottom: 0.0);
  }
}

HostSafeInsets _computeEffectiveInsets() {
  final css = _readCssSafeInsets();
  return (
    top: math.max(_hostTopInset, css.top),
    bottom: math.max(_hostBottomInset, css.bottom),
  );
}

void _refreshSafeInsets() {
  final notifier = _safeInsetsNotifier;
  if (notifier == null) return;
  final next = _computeEffectiveInsets();
  if (notifier.value != next) {
    notifier.value = next;
  }
}

ValueListenable<HostSafeInsets> get hostSafeAreaInsets {
  if (_safeInsetsNotifier != null) return _safeInsetsNotifier!;
  final qp = Uri.base.queryParameters;
  final urlTop = _sanitizeInset(double.tryParse(qp['topInset'] ?? ''));
  final urlBottom = _sanitizeInset(double.tryParse(qp['bottomInset'] ?? ''));
  _hostTopInset =
      isHarmonyHost ? (urlTop > 0.0 ? urlTop : 38.0) : urlTop;
  _hostBottomInset =
      isHarmonyHost ? (urlBottom > 0.0 ? urlBottom : 18.0) : urlBottom;

  _safeInsetsNotifier = ValueNotifier<HostSafeInsets>(_computeEffectiveInsets());

  if (!_safeInsetListenersAttached) {
    _safeInsetListenersAttached = true;
    try {
      globalContext['__epUpdateSafeInsets'] =
          ((JSNumber top, JSNumber bottom) {
        final nextTop = _sanitizeInset(top.toDartDouble);
        final nextBottom = _sanitizeInset(bottom.toDartDouble);
        if (nextTop > 0.0 || !isHarmonyHost) {
          _hostTopInset = nextTop;
        }
        if (nextBottom > 0.0 || !isHarmonyHost) {
          _hostBottomInset = nextBottom;
        }
        _refreshSafeInsets();
      }).toJS;

      globalContext.callMethod<JSAny?>(
        'addEventListener'.toJS,
        'resize'.toJS,
        ((JSAny? _) {
          _refreshSafeInsets();
        }).toJS,
      );
    } catch (_) {
      // Ignore in restricted JS contexts.
    }
  }
  return _safeInsetsNotifier!;
}

String resolveDefaultSyncBaseUrl() {
  const configured = String.fromEnvironment('EP_SYNC_API_BASE', defaultValue: '');
  if (configured.isNotEmpty) {
    return configured.endsWith('/')
        ? configured.substring(0, configured.length - 1)
        : configured;
  }
  if (isHarmonyHost) {
    return kDefaultSyncApiBase;
  }
  final base = Uri.base;
  if (base.scheme == 'http' || base.scheme == 'https') {
    final resolved = base.resolve('/api/sync/v1').toString();
    return resolved.endsWith('/')
        ? resolved.substring(0, resolved.length - 1)
        : resolved;
  }
  return '';
}

Completer<QrScanResult>? _pendingQrScan;

Future<QrScanResult> invokePlatformQrScanner() async {
  if (!isHarmonyHost) {
    return const QrScanResult(status: QrScanStatus.unavailable);
  }
  if (_pendingQrScan != null && !_pendingQrScan!.isCompleted) {
    _pendingQrScan!.complete(const QrScanResult(status: QrScanStatus.cancelled));
  }
  final completer = Completer<QrScanResult>();
  _pendingQrScan = completer;

  globalContext['__epOnQrScanResult'] = ((JSString status, JSString payload) {
    final active = _pendingQrScan;
    if (active == null || active.isCompleted) return;
    final st = status.toDart;
    final pl = payload.toDart;
    switch (st) {
      case 'success':
        if (pl.trim().isNotEmpty) {
          active.complete(
            QrScanResult(status: QrScanStatus.success, payload: pl.trim()),
          );
        } else {
          active.complete(const QrScanResult(status: QrScanStatus.cancelled));
        }
        break;
      case 'permission_denied':
        active.complete(
          const QrScanResult(status: QrScanStatus.permissionDenied),
        );
        break;
      case 'error':
        active.complete(
          QrScanResult(
            status: QrScanStatus.error,
            message: pl.isEmpty ? null : pl,
          ),
        );
        break;
      case 'cancelled':
      default:
        active.complete(const QrScanResult(status: QrScanStatus.cancelled));
        break;
    }
  }).toJS;

  try {
    final consoleObj = globalContext.getProperty<JSObject>('console'.toJS);
    consoleObj.callMethod<JSAny?>(
      'log'.toJS,
      '[EP_BRIDGE]{"action":"scanQr"}'.toJS,
    );
  } catch (e) {
    if (!completer.isCompleted) {
      completer.complete(
        QrScanResult(status: QrScanStatus.error, message: e.toString()),
      );
    }
  }

  return completer.future.timeout(
    const Duration(seconds: 120),
    onTimeout: () => const QrScanResult(status: QrScanStatus.cancelled),
  );
}

Future<String?> invokeNativeQrScanner() async {
  final res = await invokePlatformQrScanner();
  return res.status == QrScanStatus.success ? res.payload : null;
}
