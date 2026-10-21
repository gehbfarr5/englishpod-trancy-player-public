import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'models/lesson_models.dart';
import 'tesla/just_audio_port.dart';
import 'tesla/playback_contract.dart';
import 'tesla/tesla_app.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Keep accessible DOM controls available for touch, assistive tech and browser QA.
  WidgetsBinding.instance.ensureSemantics();
  SharedPreferences? prefs;
  try { prefs = await SharedPreferences.getInstance(); } catch (_) { /* Session remains usable without storage. */ }
  final player = ContractPlayer(audioFactory: JustAudioPort.new,
    readLesson: (id) async => LessonDetail.fromJson(jsonDecode(await rootBundle.loadString('assets/lessons_safe/lesson_$id.json')) as Map<String, dynamic>),
    write: (data) async {
      final storage = prefs ??= await SharedPreferences.getInstance();
      if (!await storage.setString('ep_pbc001_web_v1', data)) throw StateError('Storage unavailable');
    });
  player.restore(prefs?.getString('ep_pbc001_web_v1'));
  final index = jsonDecode(await rootBundle.loadString('assets/lessons_safe/index.json')) as List;
  player.lessons = index.map((x) => LessonSummary.fromJson(x as Map<String, dynamic>)).toList();
  runApp(TeslaApp(player: player));
}
