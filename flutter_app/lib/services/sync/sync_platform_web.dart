bool get syncIsWeb => true;

String detectSyncPlatform({double shortestSide = 0}) => 'web';

String defaultSyncDeviceName(String platform) => 'Web Browser';

String resolveDefaultSyncBaseUrl() {
  const configured = String.fromEnvironment('EP_SYNC_API_BASE', defaultValue: '');
  if (configured.isNotEmpty) {
    return configured.endsWith('/')
        ? configured.substring(0, configured.length - 1)
        : configured;
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

Future<String?> invokeNativeQrScanner() async => null;
