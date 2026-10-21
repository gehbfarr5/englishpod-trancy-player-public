import 'dart:convert';
import 'dart:io';

import 'package:integration_test/integration_test_driver_extended.dart';

Future<void> main() async {
  final out = Directory(Platform.environment['NATIVE_REPORT_DIR'] ?? 'build/native-evidence');
  await out.create(recursive: true);
  await integrationDriver(
    writeResponseOnFailure: true,
    onScreenshot: (String name, List<int> image, [Map<String, Object?>? args]) async {
      if (!RegExp(r'^N[0-9]{2}-[a-z-]+$').hasMatch(name)) return false;
      await File('${out.path}/$name.png').writeAsBytes(image);
      return true;
    },
    responseDataCallback: (data) async {
      await File('${out.path}/response.json').writeAsString(jsonEncode({
        'scenarios': data?['nativeScenarios'] ?? [],
      }));
    },
  );
}
