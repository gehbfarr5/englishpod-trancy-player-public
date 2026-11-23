import 'dart:convert';

import 'package:http/http.dart' as http;

import 'sync_models.dart';

class SyncApiException implements Exception {
  final int statusCode;
  final String code;
  final String message;
  final int retryAfterSec;
  final int serverTimeMs;

  const SyncApiException({
    required this.statusCode,
    required this.code,
    required this.message,
    this.retryAfterSec = 0,
    this.serverTimeMs = 0,
  });

  @override
  String toString() =>
      'SyncApiException($statusCode, $code: $message)';
}

abstract class SyncApiClient {
  Future<SyncPairingTicket> createPairingTicket({
    String? bearerToken,
    required String deviceName,
    required String platform,
  });

  Future<SyncPairingStatus> getPairingStatus({
    required String bearerToken,
    required String code,
  });

  Future<SyncClaimResult> claimPairingTicket({
    required String code,
    required String deviceName,
    required String platform,
  });

  Future<SyncPushResponse> push({
    required String bearerToken,
    required List<SyncLessonDelta> lessons,
    SyncLastOpened? lastOpened,
  });

  Future<SyncPullResponse> pull({
    required String bearerToken,
    required int sinceSeq,
  });

  Future<(int serverTimeMs, List<SyncDeviceSummary> devices)> listDevices({
    required String bearerToken,
  });

  Future<(int serverTimeMs, SyncDeviceSummary device)> renameDevice({
    required String bearerToken,
    required String deviceName,
  });

  Future<int> revokeDevice({
    required String bearerToken,
    required String deviceId,
  });
}

class HttpSyncApiClient implements SyncApiClient {
  final String baseUrl;
  http.Client? _client;
  final Duration timeout;

  HttpSyncApiClient({
    required String baseUrl,
    http.Client? client,
    this.timeout = const Duration(seconds: 12),
  })  : baseUrl = baseUrl.endsWith('/')
            ? baseUrl.substring(0, baseUrl.length - 1)
            : baseUrl,
        _client = client;

  http.Client get _httpClient => _client ??= http.Client();

  Uri _endpoint(String path, [Map<String, String>? query]) {
    if (baseUrl.isEmpty) {
      throw const SyncApiException(
        statusCode: 0,
        code: 'SYNC_NOT_CONFIGURED',
        message: 'Sync server endpoint is not configured in this build.',
      );
    }
    final uri = Uri.parse('$baseUrl$path');
    if (query == null || query.isEmpty) return uri;
    return uri.replace(queryParameters: query);
  }

  Map<String, String> _headers({String? bearerToken, bool hasBody = false}) => {
        if (hasBody) 'Content-Type': 'application/json',
        if (bearerToken != null && bearerToken.isNotEmpty)
          'Authorization': 'Bearer $bearerToken',
      };

  Future<Map<String, dynamic>> _request(
    String method,
    Uri uri, {
    String? bearerToken,
    Object? body,
  }) async {
    final encodedBody = body != null ? jsonEncode(body) : null;
    final headers = _headers(
      bearerToken: bearerToken,
      hasBody: encodedBody != null,
    );

    late http.Response resp;
    try {
      final client = _httpClient;
      switch (method) {
        case 'GET':
          resp = await client.get(uri, headers: headers).timeout(timeout);
        case 'POST':
          resp = await client
              .post(uri, headers: headers, body: encodedBody)
              .timeout(timeout);
        case 'PATCH':
          resp = await client
              .patch(uri, headers: headers, body: encodedBody)
              .timeout(timeout);
        case 'DELETE':
          resp = await client.delete(uri, headers: headers).timeout(timeout);
        default:
          throw UnsupportedError('Unsupported HTTP method $method');
      }
    } catch (e) {
      throw SyncApiException(
        statusCode: 0,
        code: 'NETWORK_ERROR',
        message: e.toString(),
      );
    }

    Map<String, dynamic> decoded = const {};
    if (resp.bodyBytes.isNotEmpty) {
      try {
        final raw = jsonDecode(utf8.decode(resp.bodyBytes));
        if (raw is Map<String, dynamic>) {
          decoded = raw;
        }
      } catch (_) {}
    }

    final serverTimeMs = (decoded['serverTimeMs'] as num?)?.toInt() ?? 0;

    if (resp.statusCode >= 200 && resp.statusCode < 300) {
      return decoded;
    }

    final errMap = decoded['error'] is Map<String, dynamic>
        ? decoded['error'] as Map<String, dynamic>
        : const <String, dynamic>{};
    throw SyncApiException(
      statusCode: resp.statusCode,
      code: (errMap['code'] as String?) ?? 'HTTP_${resp.statusCode}',
      message: (errMap['message'] as String?) ??
          'Sync request failed (${resp.statusCode})',
      retryAfterSec: (errMap['retryAfterSec'] as num?)?.toInt() ?? 0,
      serverTimeMs: serverTimeMs,
    );
  }

  @override
  Future<SyncPairingTicket> createPairingTicket({
    String? bearerToken,
    required String deviceName,
    required String platform,
  }) async {
    final data = await _request(
      'POST',
      _endpoint('/pair/create'),
      bearerToken: bearerToken,
      body: {
        'deviceName': deviceName,
        'platform': platform,
      },
    );
    return SyncPairingTicket.fromJson(data);
  }

  @override
  Future<SyncPairingStatus> getPairingStatus({
    required String bearerToken,
    required String code,
  }) async {
    final data = await _request(
      'GET',
      _endpoint('/pair/status', {'code': code}),
      bearerToken: bearerToken,
    );
    return SyncPairingStatus.fromJson(data);
  }

  @override
  Future<SyncClaimResult> claimPairingTicket({
    required String code,
    required String deviceName,
    required String platform,
  }) async {
    final data = await _request(
      'POST',
      _endpoint('/pair/claim'),
      body: {
        'code': code,
        'deviceName': deviceName,
        'platform': platform,
      },
    );
    return SyncClaimResult.fromJson(data);
  }

  @override
  Future<SyncPushResponse> push({
    required String bearerToken,
    required List<SyncLessonDelta> lessons,
    SyncLastOpened? lastOpened,
  }) async {
    final data = await _request(
      'POST',
      _endpoint('/sync/push'),
      bearerToken: bearerToken,
      body: {
        'lessons': lessons.map((l) => l.toPushJson()).toList(),
        if (lastOpened != null) 'lastOpened': lastOpened.toPushJson(),
      },
    );
    return SyncPushResponse.fromJson(data);
  }

  @override
  Future<SyncPullResponse> pull({
    required String bearerToken,
    required int sinceSeq,
  }) async {
    final data = await _request(
      'GET',
      _endpoint('/sync/pull', {'since_seq': '$sinceSeq'}),
      bearerToken: bearerToken,
    );
    return SyncPullResponse.fromJson(data);
  }

  @override
  Future<(int, List<SyncDeviceSummary>)> listDevices({
    required String bearerToken,
  }) async {
    final data = await _request(
      'GET',
      _endpoint('/devices'),
      bearerToken: bearerToken,
    );
    final serverTimeMs = (data['serverTimeMs'] as num?)?.toInt() ?? 0;
    final rawDevices = (data['devices'] as List<dynamic>?) ?? const [];
    final list = rawDevices
        .whereType<Map<String, dynamic>>()
        .map(SyncDeviceSummary.fromJson)
        .toList();
    return (serverTimeMs, list);
  }

  @override
  Future<(int, SyncDeviceSummary)> renameDevice({
    required String bearerToken,
    required String deviceName,
  }) async {
    final data = await _request(
      'PATCH',
      _endpoint('/devices/me'),
      bearerToken: bearerToken,
      body: {'deviceName': deviceName},
    );
    final serverTimeMs = (data['serverTimeMs'] as num?)?.toInt() ?? 0;
    final devJson = data['device'] is Map<String, dynamic>
        ? data['device'] as Map<String, dynamic>
        : const <String, dynamic>{};
    return (serverTimeMs, SyncDeviceSummary.fromJson(devJson));
  }

  @override
  Future<int> revokeDevice({
    required String bearerToken,
    required String deviceId,
  }) async {
    final data = await _request(
      'DELETE',
      _endpoint('/devices/$deviceId'),
      bearerToken: bearerToken,
    );
    return (data['serverTimeMs'] as num?)?.toInt() ?? 0;
  }
}
