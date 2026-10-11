"""Capture real emulator previews or tap a labelled app control for manual QA.

Example: python scripts/android-ui-qa.py --tap Profile --capture profile
Only emulators are accepted. This does not clear data, sign in, or submit forms.
"""
import argparse
import os
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--serial', default='emulator-5554')
parser.add_argument('--tap')
parser.add_argument('--capture')
args = parser.parse_args()
if not args.serial.startswith('emulator-'):
    parser.error('Use a disposable emulator for UI QA.')
adb = Path(os.environ['LOCALAPPDATA']) / 'Android/Sdk/platform-tools/adb.exe'


def run(*cmd):
    return subprocess.check_output([str(adb), '-s', args.serial, *cmd], timeout=25)


def tree():
    run('shell', 'uiautomator', 'dump', '/sdcard/plugorbit-qa.xml')
    root = ET.fromstring(run('shell', 'cat', '/sdcard/plugorbit-qa.xml').decode('utf-8'))
    if not any(n.get('package') == 'com.loginapp' for n in root.iter('node')):
        raise SystemExit('PlugOrbit is not in the foreground; no tap performed.')
    return root


root = tree()
if args.tap:
    parents = {child: parent for parent in root.iter() for child in parent}
    matches = [n for n in root.iter('node') if args.tap in (n.get('text'), n.get('content-desc'))]
    if not matches:
        raise SystemExit(f'Control not visible: {args.tap}')
    actionable = []
    for node in matches:
        while node.get('clickable') != 'true' and node in parents:
            node = parents[node]
        if node.get('clickable') == 'true' and node.get('enabled') == 'true':
            actionable.append(node)
    if not actionable:
        raise SystemExit(f'Control is not actionable: {args.tap}')
    def area(node):
        x1, y1, x2, y2 = map(int, re.findall(r'\d+', node.get('bounds', '')))
        return (x2-x1)*(y2-y1)
    node = min(actionable, key=area)
    x1, y1, x2, y2 = map(int, re.findall(r'\d+', node.get('bounds', '')))
    run('shell', 'input', 'tap', str((x1+x2)//2), str((y1+y2)//2))
    time.sleep(2)
    root = tree()
if args.capture:
    if not re.fullmatch(r'[a-z0-9-]+', args.capture):
        parser.error('Capture names must use lowercase letters, numbers and hyphens.')
    target = Path(__file__).resolve().parents[1] / 'docs/quality/screenshots' / f'{args.capture}.png'
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(run('exec-out', 'screencap', '-p'))
    print(target)
print([(n.get('text') or n.get('content-desc')) for n in root.iter('node')
       if n.get('text') or n.get('content-desc')])
