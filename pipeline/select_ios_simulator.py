#!/usr/bin/env python3
"""Select an actually installed iOS runtime, not an assumed device OS patch."""
import json
import os
import subprocess


def run(*args):
    return subprocess.check_output(['xcrun', 'simctl', *args], text=True)


def main():
    runtimes = json.loads(run('list', 'runtimes', '--json'))['runtimes']
    choices = [r for r in runtimes if r.get('isAvailable') and r['identifier'].startswith('com.apple.CoreSimulator.SimRuntime.iOS-')]
    if not choices:
        raise SystemExit('No available iOS runtime; environment blocked, not a passing test')
    runtime = max(choices, key=lambda r: tuple(int(n) for n in r['version'].split('.')))
    types = json.loads(run('list', 'devicetypes', '--json'))['devicetypes']
    supported = {t['identifier'] for t in runtime.get('supportedDeviceTypes', [])}
    phones = [t for t in types if t['name'].startswith('iPhone') and (not supported or t['identifier'] in supported)]
    if not phones:
        raise SystemExit('No supported iPhone Simulator device type')
    model = next((t for t in phones if t['name'] == 'iPhone 17'), phones[0])
    device = run('create', 'EnglishPodRegression', model['identifier'], runtime['identifier']).strip()
    run('boot', device)
    # Open Simulator GUI on macOS runner to ensure CoreSimulator logging stream is active
    subprocess.run(['open', '-a', 'Simulator', '--args', '-CurrentDeviceUDID', device], check=False)
    subprocess.run(['xcrun', 'simctl', 'bootstatus', device, '-b'], check=True)
    with open(os.environ['GITHUB_ENV'], 'a') as env:
        env.write(f"NATIVE_DEVICE={device}\nNATIVE_RUNTIME={runtime['name']} {model['name']}\n")


if __name__ == '__main__':
    main()
