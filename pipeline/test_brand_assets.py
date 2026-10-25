import json
import unittest
from pathlib import Path
from collections import Counter

try:
    from PIL import Image
    HAS_PIL = True
except ImportError:
    HAS_PIL = False

ROOT = Path(__file__).resolve().parents[1]
BRANDING_DIR = ROOT / "flutter_app/assets/branding"
IOS_APPICON_DIR = ROOT / "flutter_app/ios/Runner/Assets.xcassets/AppIcon.appiconset"

DARK_GREEN = (0x1E, 0xD7, 0x60)   # #1ED760
LIGHT_CLAY = (0xCC, 0x78, 0x5C)   # #CC785C (土色)


class BrandAssetsContractTests(unittest.TestCase):
    def test_canonical_brand_artwork_colors(self):
        dark_png = BRANDING_DIR / "brand_icon_dark.png"
        light_png = BRANDING_DIR / "brand_icon_light.png"
        self.assertTrue(dark_png.is_file(), "brand_icon_dark.png missing")
        self.assertTrue(light_png.is_file(), "brand_icon_light.png missing")
        self.assertGreater(dark_png.stat().st_size, 1000)
        self.assertGreater(light_png.stat().st_size, 1000)

        if not HAS_PIL:
            return

        im_dark = Image.open(dark_png).convert("RGB")
        im_light = Image.open(light_png).convert("RGB")
        self.assertEqual(im_dark.size, (1024, 1024))
        self.assertEqual(im_light.size, (1024, 1024))

        c_dark = Counter(im_dark.get_flattened_data() if hasattr(im_dark, 'get_flattened_data') else im_dark.getdata())
        c_light = Counter(im_light.get_flattened_data() if hasattr(im_light, 'get_flattened_data') else im_light.getdata())

        # Dark icon must have dark theme green #1ED760 and NO light clay #CC785C
        has_dark_green = any(abs(r - DARK_GREEN[0]) < 10 and abs(g - DARK_GREEN[1]) < 10 and abs(b - DARK_GREEN[2]) < 10 for (r, g, b), _ in c_dark.items())
        has_clay_in_dark = any(abs(r - LIGHT_CLAY[0]) < 10 and abs(g - LIGHT_CLAY[1]) < 10 and abs(b - LIGHT_CLAY[2]) < 10 for (r, g, b), _ in c_dark.items())
        self.assertTrue(has_dark_green, "brand_icon_dark.png must contain dark theme accent #1ED760")
        self.assertFalse(has_clay_in_dark, "brand_icon_dark.png must NOT contain light clay/earthy color #CC785C")

        # Light icon must have light clay #CC785C and NO dark green #1ED760
        has_clay_in_light = any(abs(r - LIGHT_CLAY[0]) < 10 and abs(g - LIGHT_CLAY[1]) < 10 and abs(b - LIGHT_CLAY[2]) < 10 for (r, g, b), _ in c_light.items())
        has_dark_in_light = any(abs(r - DARK_GREEN[0]) < 10 and abs(g - DARK_GREEN[1]) < 10 and abs(b - DARK_GREEN[2]) < 10 for (r, g, b), _ in c_light.items())
        self.assertTrue(has_clay_in_light, "brand_icon_light.png must contain light theme accent #CC785C")
        self.assertFalse(has_dark_in_light, "brand_icon_light.png must NOT contain dark theme accent #1ED760")

    def test_ios_appicon_set_dark_mode_alignment(self):
        contents_file = IOS_APPICON_DIR / "Contents.json"
        self.assertTrue(contents_file.is_file(), "AppIcon Contents.json missing")
        data = json.loads(contents_file.read_text(encoding="utf-8"))
        images = data.get("images", [])
        self.assertTrue(len(images) >= 30, f"Expected full set of AppIcon entries, got {len(images)}")

        # Check iOS 18 universal entries
        universal_entries = [img for img in images if img.get("idiom") == "universal"]
        self.assertTrue(any(e.get("filename") == "Icon-App-1024x1024@1x.png" and "appearances" not in e for e in universal_entries))
        self.assertTrue(any(e.get("filename") == "Icon-App-1024x1024-Dark@1x.png" and e.get("appearances") == [{"appearance": "luminosity", "value": "dark"}] for e in universal_entries))
        self.assertTrue(any(e.get("filename") == "Icon-App-1024x1024-Tinted@1x.png" and e.get("appearances") == [{"appearance": "luminosity", "value": "tinted"}] for e in universal_entries))

        # Check all dark PNG files in appiconset
        dark_pngs = list(IOS_APPICON_DIR.glob("*-Dark*.png"))
        self.assertTrue(len(dark_pngs) >= 14, f"Expected at least 14 dark icon variants, found {len(dark_pngs)}")

        for dark_file in dark_pngs:
            self.assertGreater(dark_file.stat().st_size, 100, f"{dark_file.name} is too small")
            if not HAS_PIL:
                continue
            im = Image.open(dark_file).convert("RGB")
            c = Counter(im.get_flattened_data() if hasattr(im, 'get_flattened_data') else im.getdata())
            has_clay = any(abs(r - LIGHT_CLAY[0]) < 10 and abs(g - LIGHT_CLAY[1]) < 10 and abs(b - LIGHT_CLAY[2]) < 10 for (r, g, b), _ in c.items())
            self.assertFalse(has_clay, f"{dark_file.name} must NOT use light clay/earthy color #CC785C")

            has_green = any(abs(r - DARK_GREEN[0]) < 10 and abs(g - DARK_GREEN[1]) < 10 and abs(b - DARK_GREEN[2]) < 10 for (r, g, b), _ in c.items())
            has_black = any(r == 0 and g == 0 and b == 0 for (r, g, b), _ in c.items())
            self.assertTrue(has_black, f"{dark_file.name} must have black background")
            self.assertTrue(has_green, f"{dark_file.name} must use dark theme accent #1ED760")


if __name__ == "__main__":
    unittest.main()
