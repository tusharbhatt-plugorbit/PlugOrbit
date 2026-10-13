"""Record a read-only app walkthrough. Never submit auth, bookings, payments or tickets."""
from pathlib import Path
import subprocess, time, re, json, xml.etree.ElementTree as ET
ADB=r'C:\Users\Admin\AppData\Local\Android\Sdk\platform-tools\adb.exe'
SERIAL='ZA222LQGPT'
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'videos'
OUT.mkdir(exist_ok=True)
marks=[]
started=0

def adb(*args, timeout=20):
 return subprocess.check_output([ADB,'-s',SERIAL,*args],text=True,encoding='utf-8',errors='replace',timeout=timeout)
def foreground():
 text=adb('shell','dumpsys','activity','activities')
 line=next((x for x in text.splitlines() if 'topResumedActivity' in x),'')
 return 'com.loginapp/.MainActivity' in line
def guard():
 if not foreground():raise RuntimeError('PlugOrbit left foreground; recording stopped for privacy.')
def nodes():
 guard()
 adb('shell','uiautomator','dump','/sdcard/Download/plugorbit-video-ui.xml')
 xml=adb('shell','cat','/sdcard/Download/plugorbit-video-ui.xml')
 return list(ET.fromstring(xml).iter('node'))
def locate(label, scroll=False):
 for attempt in range(5 if scroll else 1):
  ns=nodes()
  exact=[n for n in ns if n.get('content-desc')==label or n.get('text')==label]
  matches=exact or [n for n in ns if n.get('content-desc','').startswith(label+'.') or n.get('content-desc','').startswith(label+',')]
  matches.sort(key=lambda n:n.get('clickable')!='true')
  for n in matches:
   b=list(map(int,re.findall(r'\d+',n.get('bounds',''))))
   if len(b)==4 and b[1]>=70 and b[3]<2330 and b[2]>b[0] and b[3]>b[1]:return ((b[0]+b[2])//2,(b[1]+b[3])//2)
  if scroll and attempt<4:swipe()
 return None
def tap(label, scroll=False, required=True):
 xy=locate(label,scroll)
 if xy is None:
  if required:raise RuntimeError('Visible control not found: '+label)
  print('SKIP',label,flush=True);return False
 guard();adb('shell','input','tap',str(xy[0]),str(xy[1]));time.sleep(1.5);return True
def swipe(up=True):
 guard();adb('shell','input','swipe','550','1800' if up else '650','550','650' if up else '1800','500');time.sleep(.8)
def back():
 guard();adb('shell','input','keyevent','4');time.sleep(1.2)
def show(title, seconds=6):
 guard();begin=time.monotonic()-started;print('SHOW',title,flush=True)
 for _ in range(seconds):
  time.sleep(1);guard()
 marks.append({'title':title,'start':begin,'end':time.monotonic()-started})
def visit(label,title=None,scroll=False):
 if tap(label,scroll,required=False):show(title or label);back();return True
 return False

def record():
 global started
 guard()
 if locate('Get Started') or locate('Already have an account? Sign In'):
  raise RuntimeError('Sign in manually before recording the authenticated walkthrough.')
 adb('shell','input','keyevent','4') if False else None
 recorder=subprocess.Popen([ADB,'-s',SERIAL,'shell','screenrecord','--size','720x1600','--bit-rate','4M','--time-limit','0','/sdcard/Download/PlugOrbit-walkthrough-raw.mp4'],stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
 time.sleep(1);pids=adb('shell','pidof','screenrecord').split()
 if len(pids)!=1:recorder.terminate();raise RuntimeError('Cannot uniquely identify this recording process.')
 started=time.monotonic()
 try:
  tap('Home');show('Home | Charging map and nearby stations',8)
  visit('Filters','Find chargers | Connector and availability filters')
  tap('Trips');show('Trips | Your route and charging plan',8)
  visit('Where to?','Plan a trip | Address search and current location')
  visit('Open route','Route overview | Road route and charging stops')
  visit('Open Smart Drive','Smart Drive | Battery and charging guidance')
  for label,title in [('Energy planner','Energy planner | Battery at every stop'),('Multi-stop trip','Multi-stop | Add addresses and stops'),('Offline trip mode','Offline mode | Cached trip information'),('Trip preferences','Trip preferences | Safety reserve and strategy'),('Cost calculator','Charging cost | Battery targets and estimated bill')]:
   visit(label,title,True)
  tap('Charge');show('Charge | Start and manage a charging session',8)
  tap('Activity');show('Activity | Charging history and receipts',8)
  if tap('Support tickets',required=False):show('Activity | Support ticket history');tap('Charging',required=False)
  tap('Profile');show('Profile | Account, vehicle and cloud sync',8)
  for label,title in [('Vehicles','Vehicles | Your EV and compatible connectors'),('Current battery','Battery | State of charge'),('Saved chargers & routes','Saved | Chargers, addresses and routes')]:visit(label,title,True)
  for label,title in [('PlugOrbit Plus','Plus | Membership overview'),('Notifications','Notifications | Charging and trip alerts'),('Language','Language | App preferences'),('Privacy & data','Privacy | Location, battery and data controls'),('Support','Support | Contact options and ticket form'),('Roadside assistance','Roadside | Help options')]:visit(label,title,True)
  tap('Profile')
  for _ in range(5):swipe(False)
  if tap('Light',True,False):show('Appearance | Light theme');tap('System');show('Appearance | System theme')
  if tap('AI assistant',required=False):
   show('Orbit assistant | EV guide and suggestions',8)
   if tap('What is SOC?',required=False):show('Orbit assistant | Battery guidance',8)
   back()
  tap('Home');show('PlugOrbit | Charge forward',5)
 finally:
  try:adb('shell','kill','-2',pids[0])
  except Exception:pass
  try:recorder.wait(timeout=20)
  except subprocess.TimeoutExpired:recorder.terminate()
  (OUT/'walkthrough-chapters.json').write_text(json.dumps(marks,indent=2),encoding='utf-8')
  adb('pull','/sdcard/Download/PlugOrbit-walkthrough-raw.mp4',str(OUT/'PlugOrbit-walkthrough-raw.mp4'),timeout=60)
  print('SAVED',len(marks),'chapters',flush=True)
if __name__=='__main__':record()
