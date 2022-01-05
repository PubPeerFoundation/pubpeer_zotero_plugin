#!/usr/bin/env python3

import os, sys
import shutil
import json
import configparser
import argparse
import shlex
import xml.etree.ElementTree as ET
import subprocess

config = configparser.ConfigParser()
if os.path.isfile('start.ini'):
  config.read('start.ini')

argp = argparse.ArgumentParser()
argp.add_argument('--profile-path', dest='profile_path', default=config.get('profile', 'path', fallback=None))
argp.add_argument('--profile-name', dest='profile_name', default=config.get('profile', 'name', fallback=None))
argp.add_argument('--log', default=config.get('log', 'path', fallback=None))
args = argp.parse_args()

if not args.profile_path:
  print(args.usage())
  sys.exit(1)

rdf = ET.parse('build/install.rdf').getroot()
for plugin_id in rdf.findall('{http://www.w3.org/1999/02/22-rdf-syntax-ns#}Description/{http://www.mozilla.org/2004/em-rdf#}id'):
  plugin = os.path.join(args.profile_path, 'extensions', plugin_id.text)

settings = {
  'extensions.autoDisableScopes': 0,
  'extensions.enableScopes': 15,
  'extensions.startupScanScopes': 15,
  'extensions.lastAppBuildId': None,
  'extensions.lastAppVersion': None,
  'extensions.zotero.debug.log': True,
}
for prefs in ['user', 'prefs']:
  prefs = os.path.expanduser(os.path.join(args.profile_path, f'{prefs}.js'))
  if not os.path.exists(prefs): continue

  user_prefs = []
  with open(prefs) as f:
    for line in f.readlines():
      #print(line, [pref for pref in settings.keys() if pref in line])
      if len([True for pref in settings.keys() if pref in line]) == 0:
        user_prefs.append(line)
    for key, value in settings.items():
      if value is not None:
        user_prefs.append(f'user_pref({json.dumps(key)}, {json.dumps(value)});\n')

  with open(prefs, 'w') as f:
    f.write(''.join(user_prefs))

def system(cmd):
  subprocess.run(cmd, shell=True, check=True)

system('npm run build')

#system(f'rm -rf {profile}extensions.json')
system(f"rm -rf {shlex.quote(plugin + '*')}")

with open(os.path.expanduser(plugin), 'w') as f:
  path = os.path.join(os.getcwd(), 'build')
  if path[-1] != '/': path += '/'
  print(path, file=f)

cmd = '/Applications/Zotero.app/Contents/MacOS/zotero -purgecaches -P'
if args.profile_name: cmd += ' ' + shlex.quote(args.profile_name)
cmd += ' -jsconsole -ZoteroDebugText -datadir profile'
if args.log: cmd += ' > ' + shlex.quote(os.path.expanduser(args.log))
cmd += ' &'

print(cmd)
system(cmd)
