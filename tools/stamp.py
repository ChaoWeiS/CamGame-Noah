#!/usr/bin/env python3
"""Stamp a new build before each commit/push.

Writes version.json (the build id + every code file) and puts the same build id
into each page's <meta name="build">. On load, each page fetches version.json
fresh; if the page or its code is older than that, it refreshes them itself
(GitHub Pages lets browsers keep files for 10 minutes).

Usage:  python3 tools/stamp.py ["short note"]
"""
import json, sys, glob, os, datetime, re
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(root)
now = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8)))
build = now.strftime('%m%d-%H%M%S') + (('-' + re.sub(r'[^a-z0-9]+', '-', sys.argv[1].lower()).strip('-')) if len(sys.argv) > 1 else '')
files = sorted(glob.glob('js/**/*.js', recursive=True)) + sorted(glob.glob('games/**/*.js', recursive=True)) + sorted(glob.glob('games/*/manifest.json')) + ['assets/puppets/rig.json']
json.dump({'build': build, 'files': files}, open('version.json', 'w'), indent=1)
for page in ['index.html', 'phone.html', 'bear3d.html']:
    s = open(page).read()
    s = re.sub(r'<meta name="build" content="[^"]*">', f'<meta name="build" content="{build}">', s)
    open(page, 'w').write(s)
print(build)
