import 'dart:async';
import 'dart:js_interop';
import 'dart:js_interop_unsafe';

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
