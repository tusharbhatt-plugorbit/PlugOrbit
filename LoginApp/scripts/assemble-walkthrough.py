from pathlib import Path
import subprocess,json,shutil,re
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'videos'
FFMPEG=next((ROOT/'video-tools'/'imageio_ffmpeg'/'binaries').glob('*.exe'))
shutil.copyfile(r'C:\Windows\Fonts\segoeui.ttf',OUT/'video-font.ttf')
def run(args):
 result=subprocess.run([str(FFMPEG),'-hide_banner','-loglevel','error','-y',*args],cwd=OUT,capture_output=True,text=True)
 if result.returncode:raise RuntimeError(result.stderr[-3000:])
chapters=json.loads((OUT/'walkthrough-chapters.json').read_text())
clips=[]
for index,chapter in enumerate(chapters):
 caption=f'chapter-{index:02d}.txt';(OUT/caption).write_text(chapter['title'],encoding='utf-8')
 output=f'part-{index:02d}.mp4'
 duration=max(1,chapter['end']-chapter['start']-.2)
 vf=f"crop=720:1490:0:60,pad=720:1560:0:0:color=0x04182F,drawtext=fontfile=video-font.ttf:textfile={caption}:fontcolor=white:fontsize=20:x=24:y=1512"
 run(['-ss',str(chapter['start']),'-i','PlugOrbit-walkthrough-raw.mp4','-t',str(duration),'-vf',vf,'-an','-r','30','-c:v','libx264','-preset','fast','-crf','21','-pix_fmt','yuv420p','-movflags','+faststart',output])
 clips.append(output);print('Rendered',chapter['title'],flush=True)
for name,title,subtitle in [('intro','PlugOrbit','APPLICATION WALKTHROUGH'),('outro','Charge Forward','A Cleaner Tomorrow')]:
 (OUT/(name+'-title.txt')).write_text(title,encoding='utf-8');(OUT/(name+'-subtitle.txt')).write_text(subtitle,encoding='utf-8')
 output=name+'.mp4'
 vf=f"drawbox=x=70:y=480:w=580:h=4:color=0x25E3C0:t=fill,drawtext=fontfile=video-font.ttf:textfile={name}-title.txt:fontcolor=white:fontsize=54:x=(w-text_w)/2:y=610,drawtext=fontfile=video-font.ttf:textfile={name}-subtitle.txt:fontcolor=0x25E3C0:fontsize=24:x=(w-text_w)/2:y=710,drawbox=x=70:y=840:w=580:h=4:color=0x075BD8:t=fill"
 run(['-f','lavfi','-i','color=c=0x04182F:s=720x1560:r=30:d=4','-vf',vf,'-an','-c:v','libx264','-preset','fast','-crf','21','-pix_fmt','yuv420p',output])
clips=['intro.mp4',*(['PlugOrbit-Opening.mp4'] if (OUT/'PlugOrbit-Opening.mp4').exists() else []),*clips,'outro.mp4']
(OUT/'concat.txt').write_text(''.join("file '"+x+"'\n" for x in clips),encoding='utf-8')
run(['-f','concat','-safe','0','-i','concat.txt','-c','copy','-movflags','+faststart','PlugOrbit-Full-Walkthrough.mp4'])
final=OUT/'PlugOrbit-Full-Walkthrough.mp4'
run(['-i',final.name,'-f','null','-'])
probe=subprocess.run([str(FFMPEG),'-hide_banner','-i',str(final)],capture_output=True,text=True)
duration=re.search(r'Duration: ([0-9:.]+)',probe.stderr)
print('VIDEO',final,'BYTES',final.stat().st_size,'DURATION',duration.group(1) if duration else 'unknown',flush=True)
(OUT/'README.md').write_text('# PlugOrbit application walkthrough\n\nA screen recording of the installed application, with chapter captions. Includes the available main app pages; no payment, booking, ticket submission or authentication is performed during recording. Orbit is an offline guide. Login is performed manually before recording; login/OTP screens and actual operator charging transactions are not represented as tested by this video.\n\nChapters:\n'+''.join('- '+x['title']+'\n' for x in chapters),encoding='utf-8')
