import 'dart:io';

import 'package:flutter/services.dart';

const MethodChannel _qrScannerChannel =
    MethodChannel('com.englishpod.trancy/qr_scanner');

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
  if (configured.isEmpty) return '';
  return configured.endsWith('/')
      ? configured.substring(0, configured.length - 1)
      : configured;
}

Future<String?> invokeNativeQrScanner() async {
  try {
    final raw = await _qrScannerChannel.invokeMethod<String>('scanQrCode');
    if (raw == null || raw.trim().isEmpty) return null;
    return raw.trim();
  } on MissingPluginException {
    return null;
  } on PlatformException {
    return null;
  }
}
