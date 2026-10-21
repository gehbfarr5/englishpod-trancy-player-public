#!/usr/bin/env python3
"""Generate isolated native-test assets; never fetch or alter course sources."""
import argparse
import array
import json
import math
import os
from pathlib import Path
import re
import sys
import wave

ROOT = Path(__file__).resolve().parents[1]


def prepare(root):
    root = Path(root)
    app = root / 'flutter_app'
    if os.environ.get('EP_NATIVE_TEST_WORKSPACE') != '1':
        raise ValueError('Requires an isolated test checkout and EP_NATIVE_TEST_WORKSPACE=1')
    audio_root = app / 'assets/audio'
    # Refuse to replace a local full-audio installation. An empty CI checkout is required.
    if audio_root.exists() and any(p.is_file() and p.name != '.gitkeep' for p in audio_root.rglob('*')):
        raise ValueError('Refusing to overwrite existing audio assets')
    manifest = (app / 'pubspec.yaml').read_text()
    for path in re.findall(r'^    - (assets/audio/[0-9]{4}/)$', manifest, re.M):
        (app / path).mkdir(parents=True, exist_ok=True)
    out = app / 'assets/lessons_safe'
    out.mkdir(parents=True, exist_ok=True)
    # Only git-ignored generated metadata is replaced, never assets/lessons or processed_lessons.
    for path in out.glob('*.json'):
        if path.is_symlink():
            raise ValueError('Symlink in generated test directory')
        path.unlink()
    folder = app / 'assets/audio/0001'
    folder.mkdir(parents=True, exist_ok=True)
    for track, frequency in [('pb', 220), ('dg', 330)]:
        samples = array.array('h', (int(1200 * math.sin(2 * math.pi * frequency * i / 8000))
                                    for i in range(8000 * 60)))
        if sys.byteorder != 'little':
            samples.byteswap()
        with wave.open(str(folder / f'{track}.wav'), 'wb') as stream:
            stream.setparams((1, 2, 8000, 0, 'NONE', 'not compressed'))
            stream.writeframes(samples.tobytes())
    summary = dict(lesson_id='0001', lesson_number=1, code='B0001', level='Elementary',
                   title='Native regression fixture', dg_count=3, pb_count=3, vocab_count=0,
                   audio={'pb': 'pb.wav', 'dg': 'dg.wav'})
    detail = {**summary, 'LessonId': '0001', 'raw_title': summary['title'], 'vocabulary': [],
              'tracks': {t: [dict(id=i + 1, speaker='A', text=f'{t.upper()} fixture sentence {i + 1}.',
                                  start=float(i * 15), end=float((i + 1) * 15), words=[])
                             for i in range(3)] for t in ('pb', 'dg')}}
    (out / 'index.json').write_text(json.dumps([summary]))
    (out / 'lesson_0001.json').write_text(json.dumps(detail))
    marker = app / 'build/native-fixture.json'
    marker.parent.mkdir(parents=True, exist_ok=True)
    marker.write_text(json.dumps({'resourceKind': 'synthetic-wav', 'lessonCount': 1}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=ROOT)
    prepare(parser.parse_args().root)
