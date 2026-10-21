"""Protect original brand assets/components while Web geometry evolves."""
import hashlib
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
EXPECTED = {'AppPalette': '3773b95a56442c1dc89f034e35e8612853b5341a86e95db66faf745f2d3b0cd5', '_HandDrawnSmileyPainter': 'b17d6227b02eda0fe8c2149da7f585353a82f58d856eb822cf084054caeacbd4', '_HoldToReplayCourseCard': '2f398b36342c8916f95c941fd839fe90ca36ab25add48da6b3703f5d17cd1800', '_HoldToReplayCourseCardState': 'cc5a80f223bd2965556c5773cbe9535f525ca07485778f82f4c9ac3b0fdae0fb', '_HoldToReplayTopLiveCard': '90eb1342718a741025426c313834141fdfde04edf1e7332f001ff10fd2f7261b', '_HoldToReplayTopLiveCardState': '380ae7111df0ea6fb467357a0c5553bc05088d5ba4fb0ad516d90edd3e898577'}

def component(text, name):
    # The contract changes only the Web resume icon's action; retain the original
    # active-audio indicator, shape and all hold/replay animation code.
    text = text.replace('  final bool playActionOnly;\n', '')
    text = text.replace('    this.playActionOnly = false,\n', '')
    text = text.replace('widget.isPlaying && !widget.playActionOnly', 'widget.isPlaying')
    start = re.search(r'^class ' + re.escape(name) + r'\b', text, re.M).start()
    following = re.search(r'^class |^enum ', text[start + 1:], re.M)
    return text[start:start + 1 + following.start()] if following else text[start:]

class OriginalWebDesignTest(unittest.TestCase):
    def test_original_palette_artwork_and_course_cards(self):
        text = (ROOT / 'flutter_app/lib/main.dart').read_text()
        for name, expected in EXPECTED.items():
            with self.subTest(component=name):
                self.assertEqual(hashlib.sha256(component(text, name).encode()).hexdigest(), expected)

    def test_default_original_entry_is_built(self):
        action = (ROOT / '.github/actions/web-build/action.yml').read_text()
        self.assertIn('flutter build web --release --no-web-resources-cdn', action)
        self.assertNotIn('web_main.dart', action)
