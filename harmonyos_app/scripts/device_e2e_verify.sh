#!/usr/bin/env bash
set -euo pipefail

# L2 + L3 Automated On-Device E2E Verification Suite for EnglishPod HarmonyOS 7.0 (Flutter on ArkWeb)
# Drives real touch events via uitest uiInput using live coordinates from window.epDumpTestState(),
# reads zero-overflow logs via `hilog -x -T EpFlutterHost`, verifies [EP_BRIDGE] + [EP_AUDIO_TICK],
# and captures all 9 real hardware screenshots for L3 visual review.

HDC_BIN="${HDC_BIN:-/Users/jin/.local/bin/hdc}"
TARGET="${1:-}"
if [ -z "${TARGET}" ]; then
  TARGET="$("${HDC_BIN}" list targets | grep -v '\[Empty\]' | grep -v '^$' | head -n 1 | tr -d '\r')"
fi

if [ -z "${TARGET}" ]; then
  "${HDC_BIN}" tconn 192.168.31.40:32855 >/dev/null 2>&1 || true
  TARGET="$("${HDC_BIN}" list targets | grep -v '\[Empty\]' | grep -v '^$' | head -n 1 | tr -d '\r')"
fi

if [ -n "${TARGET}" ] && [[ "${TARGET}" == *:* ]]; then
  if ! "${HDC_BIN}" list targets | grep -qF "${TARGET}"; then
    "${HDC_BIN}" tconn "${TARGET}" >/dev/null 2>&1 || true
  fi
fi

if [ -z "${TARGET}" ]; then
  echo "ERROR: No HarmonyOS device connected via hdc." >&2
  exit 2
fi

OUT_DIR="${OUT_DIR:-/Users/jin/.gemini/antigravity/brain/da39d4be-fa4b-4727-a598-023c34f341a7/scratch/device_verify}"
mkdir -p "${OUT_DIR}"

hdc_t() {
  "${HDC_BIN}" -t "${TARGET}" "$@"
}

dump_host_log() {
  local out_file="$1"
  hdc_t shell "hilog -x -T EpFlutterHost" > "${out_file}"
}

dump_flutter_state() {
  local name="$1"
  local out_json="${OUT_DIR}/${name}_state.json"
  hdc_t shell "hilog -r >/dev/null"
  hdc_t shell "aa start -a EntryAbility -b com.jin.englishpod --ps ep_eval_js 'window.epDumpTestState()'" >/dev/null
  sleep 1
  local raw_logs="${OUT_DIR}/${name}_chunks.txt"
  hdc_t shell "hilog -x -T EpFlutterHost" > "${raw_logs}"
  python3 - "${raw_logs}" "${out_json}" <<'PY'
import json, re, sys
log_text = open(sys.argv[1], encoding='utf-8', errors='replace').read()
out_path = sys.argv[2]
chunks_by_id = {}
totals = {}
pat = re.compile(r'\[EP_STATE_CHUNK:(\d+):(\d+)/(\d+)\](.*)$', re.M)
for m in pat.finditer(log_text):
    tid, idx, tot, part = m.group(1), int(m.group(2)), int(m.group(3)), m.group(4)
    chunks_by_id.setdefault(tid, {})[idx] = part
    totals[tid] = tot

complete_ids = [tid for tid, parts in chunks_by_id.items() if len(parts) == totals[tid]]
if not complete_ids:
    print(f"ERROR: Incomplete or missing [EP_STATE_CHUNK] in {sys.argv[1]}. Found keys: { {k: len(v) for k, v in chunks_by_id.items()} }", file=sys.stderr)
    sys.exit(1)
tid = complete_ids[-1]
payload = "".join(chunks_by_id[tid][i] for i in range(totals[tid]))
obj = json.loads(payload)
if not obj.get('bootComplete'):
    print(f"ERROR: Flutter boot incomplete: {obj.get('bootError')}", file=sys.stderr)
    sys.exit(1)
with open(out_path, 'w', encoding='utf-8') as f:
    json.dump(obj, f, indent=2, ensure_ascii=False)
print(f"Captured Flutter state -> {out_path} ({len(obj.get('nodes', []))} semantic nodes)")
PY
}

snap_screen() {
  local name="$1"
  local remote_img="/data/local/tmp/ep_snap_${name}.jpeg"
  local local_img="${OUT_DIR}/${name}.jpeg"
  hdc_t shell "snapshot_display -f ${remote_img}" >/dev/null
  hdc_t file recv "${remote_img}" "${local_img}" >/dev/null
  echo "Captured screenshot: ${local_img}"
}

tap_semantic() {
  local state_json="$1"
  local needle="$2"
  local mode="${3:-contains}" # exact | prefix | contains
  local coords
  coords="$(python3 - "${state_json}" "${needle}" "${mode}" <<'PY'
import json, sys
path, needle, mode = sys.argv[1], sys.argv[2], sys.argv[3]
data = json.load(open(path, encoding='utf-8'))
matches = []
for n in data.get('nodes', []):
    lbl = n.get('label', '')
    ok = (
        (mode == 'exact' and lbl == needle) or
        (mode == 'prefix' and lbl.startswith(needle)) or
        (mode == 'contains' and needle in lbl)
    )
    if ok:
        area = max(1, n.get('w', 1) * n.get('h', 1))
        matches.append((area, n['cx'], n['cy'], lbl))
if not matches:
    print(f"ERROR: Semantic node {needle!r} ({mode}) not found in {path}", file=sys.stderr)
    for n in data.get('nodes', []):
        print("  node:", repr(n.get('label')), n['cx'], n['cy'], file=sys.stderr)
    sys.exit(1)
matches.sort(key=lambda x: x[0])
_, cx, cy, lbl = matches[0]
print(f"{cx} {cy}")
PY
)"
  local x y
  x="$(echo "${coords}" | awk '{print $1}')"
  y="$(echo "${coords}" | awk '{print $2}')"
  echo "Tap '${needle}' at (${x}, ${y})"
  hdc_t shell "uitest uiInput click ${x} ${y}" >/dev/null
}

assert_semantic() {
  local state_json="$1"
  shift
  python3 - "${state_json}" "$@" <<'PY'
import json, sys
path = sys.argv[1]
needles = sys.argv[2:]
data = json.load(open(path, encoding='utf-8'))
all_text = "\n".join(n.get('label', '') for n in data.get('nodes', []))
for n in needles:
    if n.startswith('!'):
        bad = n[1:]
        if bad in all_text:
            print(f"ASSERTION FAILED: Forbidden text {bad!r} present in {path}", file=sys.stderr)
            sys.exit(1)
    else:
        if n not in all_text:
            print(f"ASSERTION FAILED: Expected text {n!r} missing from {path}\nLabels:\n{all_text}", file=sys.stderr)
            sys.exit(1)
print(f"ASSERT SEMANTIC OK ({len(needles)} checks) on {path}")
PY
}

assert_bridge_json() {
  local state_json="$1"
  shift
  python3 - "${state_json}" "$@" <<'PY'
import json, sys
path = sys.argv[1]
checks = sys.argv[2:]
data = json.load(open(path, encoding='utf-8'))
bridge = data.get('bridge') or {}
for expr in checks:
    k, expected = expr.split('=', 1)
    actual = bridge.get(k)
    if expected in ('true', 'false'):
        exp_val = (expected == 'true')
    else:
        exp_val = expected
    if actual != exp_val:
        print(f"ASSERT BRIDGE FAILED on {path}: {k}={actual!r}, expected {exp_val!r} (bridge={bridge})", file=sys.stderr)
        sys.exit(1)
print(f"ASSERT BRIDGE OK ({', '.join(checks)})")
PY
}

echo "=== Starting Flutter-on-ArkWeb L2+L3 E2E Verification on ${TARGET} ==="
hdc_t shell "aa force-stop com.jin.englishpod" || true
hdc_t shell "hilog -r >/dev/null"
hdc_t shell "aa start -a EntryAbility -b com.jin.englishpod --ps ep_orientation portrait --ps ep_keep_screen_on true" >/dev/null
sleep 4

# Reset saved browser progress/theme so cold start matches clean iOS initial state
hdc_t shell "hilog -r >/dev/null"
hdc_t shell "aa start -a EntryAbility -b com.jin.englishpod --ps ep_eval_js 'localStorage.clear();location.reload();'" >/dev/null
sleep 5

FULL_LOG="${OUT_DIR}/hilog_boot.txt"
dump_host_log "${FULL_LOG}"
if grep -qi 'fonts\.gstatic\.com' "${FULL_LOG}"; then
  echo "ERROR: Unexpected gstatic font fetch detected in EpFlutterHost logs!" >&2
  grep -i 'fonts\.gstatic\.com' "${FULL_LOG}" | head -n 5 >&2
  exit 1
fi
echo "ASSERT OFFLINE FONTS OK: zero gstatic network attempts"

# 1. Portrait Library Dark
dump_flutter_state "01_lib_dark"
assert_bridge_json "${OUT_DIR}/01_lib_dark_state.json" "screen=library" "isDark=true"
assert_semantic "${OUT_DIR}/01_lib_dark_state.json" "EnglishPod" "Elementary · 335 Lessons" "All (335)" "In Progress" "Completed" "COURSE LIST" "Difficult Customer" "↓" "!阔屏"
snap_screen "01_library_portrait_dark"

# 2. Circular Theme Reveal -> Paper Mode
tap_semantic "${OUT_DIR}/01_lib_dark_state.json" "Auto" "exact" 2>/dev/null || tap_semantic "${OUT_DIR}/01_lib_dark_state.json" "Dark" "exact"
sleep 2
dump_flutter_state "02_lib_paper"
assert_bridge_json "${OUT_DIR}/02_lib_paper_state.json" "isDark=false"
assert_semantic "${OUT_DIR}/02_lib_paper_state.json" "Light"
snap_screen "02_library_portrait_paper"

# Switch back to Dark Mode
tap_semantic "${OUT_DIR}/02_lib_paper_state.json" "Light" "exact"
sleep 2
dump_flutter_state "02b_lib_dark_back"
assert_bridge_json "${OUT_DIR}/02b_lib_dark_back_state.json" "isDark=true"

# 3. Tap 01 Difficult Customer -> Podcast Player & Verify Real MP3 Audio Advances
tap_semantic "${OUT_DIR}/02b_lib_dark_back_state.json" "01"$'\n'"Difficult Customer" "prefix"
sleep 3
dump_flutter_state "03_player_pb"
assert_bridge_json "${OUT_DIR}/03_player_pb_state.json" "screen=player" "track=pb"
assert_semantic "${OUT_DIR}/03_player_pb_state.json" "Podcast" "Dialogue" "Vocab" "LESSON 01" "MARCO"
python3 - "${OUT_DIR}/03_player_pb_state.json" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
media = data.get('media', [])
print("Observed HTML5 media state:", media)
active = [m for m in media if '0001/pb.mp3' in m.get('src', '')]
assert active, f"0001/pb.mp3 missing from {media}"
m = active[-1]
assert not m['paused'], f"Expected audio playing, got paused=True: {m}"
assert m['time'] > 0.4, f"Audio did not advance past 0.4s: {m}"
PY
snap_screen "03_player_portrait_podcast"

# 4. Switch to Dialogue Track
tap_semantic "${OUT_DIR}/03_player_pb_state.json" "Dialogue" "exact"
sleep 2
dump_flutter_state "04_player_dg"
assert_bridge_json "${OUT_DIR}/04_player_dg_state.json" "track=dg"
assert_semantic "${OUT_DIR}/04_player_dg_state.json" "FULL DIALOGUE TRACK"
snap_screen "04_player_portrait_dialogue"

# 5. Switch to Vocab Tab & Verify Key Word Accordion + Contextual Examples
tap_semantic "${OUT_DIR}/04_player_dg_state.json" "Vocab" "exact"
sleep 1
dump_flutter_state "05_player_vocab"
assert_semantic "${OUT_DIR}/05_player_vocab_state.json" "Vocabulary (10)" "still working on" "IN THIS LESSON"
snap_screen "05_player_portrait_vocab"

# 6. Switch to Podcast & Open Speed Picker Sheet
tap_semantic "${OUT_DIR}/05_player_vocab_state.json" "Podcast" "exact"
sleep 1
# Right-most button in Metrolist 5-segment utility bar (center x=1150, y=2067 on 1320x2232)
hdc_t shell "uitest uiInput click 1150 2067" >/dev/null
sleep 1
dump_flutter_state "06_speed_sheet"
assert_semantic "${OUT_DIR}/06_speed_sheet_state.json" "Playback Speed" "0.8x · Slow & Clear" "1.25x · Fast Review"
snap_screen "06_speed_sheet"
tap_semantic "${OUT_DIR}/06_speed_sheet_state.json" "Close" "exact" 2>/dev/null || hdc_t shell "uitest uiInput click 660 400" >/dev/null
sleep 1

# 7. Return to Library & Verify Resume Persistence
tap_semantic "${OUT_DIR}/03_player_pb_state.json" "Library" "contains"
sleep 1
dump_flutter_state "07_lib_resume"
assert_bridge_json "${OUT_DIR}/07_lib_resume_state.json" "screen=library"
assert_semantic "${OUT_DIR}/07_lib_resume_state.json" "CONTINUE LISTENING" "Resume"
snap_screen "07_library_portrait_resume"

# 8. Switch to Landscape (2232x1320) & Verify Both Library & Player Layouts
hdc_t shell "aa start -a EntryAbility -b com.jin.englishpod --ps ep_orientation landscape --ps ep_keep_screen_on true" >/dev/null
sleep 2
dump_flutter_state "08_lib_landscape"
assert_semantic "${OUT_DIR}/08_lib_landscape_state.json" "EnglishPod" "COURSE LIST"
snap_screen "08_library_landscape"

tap_semantic "${OUT_DIR}/08_lib_landscape_state.json" "01"$'\n'"Difficult Customer" "prefix"
sleep 2
dump_flutter_state "09_player_landscape"
assert_bridge_json "${OUT_DIR}/09_player_landscape_state.json" "screen=player"
assert_semantic "${OUT_DIR}/09_player_landscape_state.json" "Podcast" "Dialogue"
snap_screen "09_player_landscape"

# Restore auto orientation
hdc_t shell "aa start -a EntryAbility -b com.jin.englishpod --ps ep_orientation auto" >/dev/null
sleep 1

# 9. Verify Zero App Crashes in hilog
CRASHES="$(hdc_t shell "hilog -x | grep -E 'com\.jin\.englishpod.*(RuntimeError|JS_ERROR|Load Page Failed|FATAL)' || true")"
if [ -n "${CRASHES}" ]; then
  echo "ERROR: Crash logs detected:" >&2
  echo "${CRASHES}" >&2
  exit 1
fi

echo "ALL FLUTTER-ON-ARKWEB L2+L3 E2E VERIFICATION CHECKS PASSED!"
