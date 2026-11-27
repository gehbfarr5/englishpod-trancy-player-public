enum QrScanStatus {
  success,
  cancelled,
  permissionDenied,
  unavailable,
  error,
}

class QrScanResult {
  final QrScanStatus status;
  final String? payload;
  final String? message;

  const QrScanResult({
    required this.status,
    this.payload,
    this.message,
  });
}

const String kDefaultSyncApiBase = 'https://43.155.232.185:8888/api/sync/v1';
