import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

import 'sync_platform_types.dart';

const MethodChannel _qrScannerChannel =
    MethodChannel('com.englishpod.trancy/qr_scanner');

final ValueListenable<HostSafeInsets> hostSafeAreaInsets =
    ValueNotifier<HostSafeInsets>((top: 0.0, bottom: 0.0));

bool get isHarmonyHost => false;

bool get syncIsWeb => false;

String detectSyncPlatform({double shortestSide = 0}) {
  if (Platform.isIOS) {
    return shortestSide >= 600 ? 'ipad' : 'ios';
  }
  if (Platform.isAndroid) {
    return 'android';
  }
  return 'web';
}

String defaultSyncDeviceName(String platform) {
  switch (platform) {
    case 'ios':
      return 'iPhone';
    case 'ipad':
      return 'iPad';
    case 'android':
      return 'Android';
    default:
      return 'EnglishPod Device';
  }
}

String resolveDefaultSyncBaseUrl() {
  const configured = String.fromEnvironment('EP_SYNC_API_BASE', defaultValue: '');
  if (configured.isEmpty) return kDefaultSyncApiBase;
  return configured.endsWith('/')
      ? configured.substring(0, configured.length - 1)
      : configured;
}

Future<QrScanResult> invokePlatformQrScanner() async {
  try {
    final raw = await _qrScannerChannel.invokeMethod<String>('scanQrCode');
    if (raw == null || raw.trim().isEmpty) {
      return const QrScanResult(status: QrScanStatus.cancelled);
    }
    return QrScanResult(
      status: QrScanStatus.success,
      payload: raw.trim(),
    );
  } on MissingPluginException {
    return const QrScanResult(status: QrScanStatus.unavailable);
  } on PlatformException catch (e) {
    if (e.code == 'CAMERA_PERMISSION_DENIED') {
      return QrScanResult(
        status: QrScanStatus.permissionDenied,
        message: e.message,
      );
    }
    return QrScanResult(
      status: QrScanStatus.error,
      message: e.message,
    );
  }
}

Future<String?> invokeNativeQrScanner() async {
  final res = await invokePlatformQrScanner();
  return res.status == QrScanStatus.success ? res.payload : null;
}
