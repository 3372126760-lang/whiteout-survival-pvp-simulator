"""Import display artwork from the community hero directory (no game rules).
Exports the current model catalog locally before mapping source illustrations.
Uses curl for ordinary HTTPS downloads; parses static data without executing it.
"""
from concurrent.futures import ThreadPoolExecutor, as_completed
from html.parser import HTMLParser
from pathlib import Path
import hashlib,json,re,subprocess

ROOT=Path(__file__).resolve().parents[1]
BASE='https://wos.h5joy-games.com'
CACHE=ROOT/'.tmp/hero-art'; CACHE.mkdir(parents=True,exist_ok=True)
OUT=ROOT/'public/assets/heroes'; OUT.mkdir(parents=True,exist_ok=True)
subprocess.run(['node','--import','tsx','--input-type=module','-e',
    "import fs from 'node:fs';import {EXPEDITION_HERO_DATA,CONFIRMED_HERO_SKILL_DEFINITIONS} from './src/pvp/heroSkills/index.ts';fs.writeFileSync('.tmp/model-asset-heroes.json',JSON.stringify({heroes:EXPEDITION_HERO_DATA,skills:CONFIRMED_HERO_SKILL_DEFINITIONS}));"],cwd=ROOT,check=True)
model=json.loads((ROOT/'.tmp/model-asset-heroes.json').read_text(encoding='utf-8'))

def fetch(url,path):
    if path.exists() and path.stat().st_size>0:return
    r=subprocess.run(['curl.exe','-fsSL','--retry','2','--max-time','45','-A','Mozilla/5.0',url,'-o',str(path)],capture_output=True)
    if r.returncode:raise RuntimeError(url+': '+r.stderr.decode(errors='replace')[-150:])

class Images(HTMLParser):
    def __init__(self):super().__init__();self.images=[]
    def handle_starttag(self,tag,attrs):
        a=dict(attrs)
        if tag=='img':self.images.append(a)

def array(text,key):
    start=text.index(key+':[')+len(key)+1;depth=0;quote=False;escape=False
    for i in range(start,len(text)):
        c=text[i]
        if quote:
            if escape:escape=False
            elif c=='\\':escape=True
            elif c=='"':quote=False
        elif c=='"':quote=True
        elif c=='[':depth+=1
        elif c==']':
            depth-=1
            if depth==0:return text[start:i+1]
    raise ValueError(key)

fetch(BASE+'/zh-CN/heroes/',ROOT/'.tmp/hero-assets-index.html')
index=(ROOT/'.tmp/hero-assets-index.html').read_text(encoding='utf-8')
links=sorted(set(re.findall(r'href="(/zh-CN/heroes/s\d+/[\w-]+/)"',index)))
troops={'infantry':'shield','lancer':'lancer','marksmen':'marksman'}

def parse(link):
    slug=link.strip('/').split('/')[-1];path=CACHE/(slug+'.html');fetch(BASE+link,path)
    text=path.read_text(encoding='utf-8');imgs=Images();imgs.feed(text)
    portrait=next(a for a in imgs.images if 'icon_hero_avatar_' in a.get('src',''))
    weapon=next(a for a in imgs.images if re.search(r'/icon_hero_special_(?!skill_)',a.get('src','')))
    generation=int(re.search(r'/s(\d+)/',link)[1])
    troop=next(troops[m] for m in troops if any('icon_troop_'+m+'.' in a.get('src','') for a in imgs.images))
    options=[h for h in model['heroes'] if h.get('generation')==generation and h['stats']['troopType']==troop]
    if len(options)>1:
        aliases={'jeronimo':'hero.s1.heluonimo','natalia':'hero.s1.nataliya'}
        options=[h for h in options if h['id']==aliases[slug]]
    assert len(options)==1,(slug,[h['id'] for h in options])
    hero=options[0]
    entries=re.findall(r'\{id:"([^"\\]+)",name:("(?:[^"\\]|\\.)*")',array(text,'expeditionSkills'))
    assert len(entries)==3,(slug,len(entries))
    def asset(source,name):
        # Freya's HTML has a stale filename; the existing image is verified at this URL.
        source=source.replace('icon_hero_special_blood_moon_scythe_special.webp','icon_hero_special_blood_moon_scythe.webp')
        return {'name':name,'source':BASE+source,'path':'assets/heroes/'+source.rsplit('/',1)[-1]}
    skills=[dict(asset('/games/icon_hero_skill_'+sid+'.webp',json.loads(name)),slot=n+1,sourceId=sid) for n,(sid,name) in enumerate(entries)]
    weaponskills=[asset(a['src'],a.get('alt','')) for a in imgs.images if 'icon_hero_special_skill_' in a.get('src','')]
    # Only the expedition weapon skill participates in the model display.
    weapon_skill=weaponskills[-1] if weaponskills else None
    row={'name':hero['name'],'sourcePage':BASE+link,'portrait':asset(portrait['src'],hero['name']),
         'weapon':asset(weapon['src'],weapon.get('alt','')),'expeditionSkills':skills,'weaponSkill':weapon_skill}
    return hero,row

heroes={};skillmap={};assets={}
with ThreadPoolExecutor(max_workers=4) as pool:
    for job in as_completed([pool.submit(parse,link) for link in links]):
        hero,row=job.result();heroes[hero['id']]=row
        for entry in [row['portrait'],row['weapon'],*row['expeditionSkills'],row['weaponSkill']]:
            if entry:assets[entry['source']]=entry
        for skill in hero['expeditionSkills']:
            art=row['expeditionSkills'][skill['expeditionSkillSlot']-1]
            skillmap[skill['id']]=art
            if skill.get('combatSkillDefinitionId'):skillmap[skill['combatSkillDefinitionId']]=art
        for skill in model['skills']:
            if skill['heroId']!=hero['id']:continue
            rule=skill['positionRule']
            if rule['kind']=='exclusiveWeapon':skillmap[skill['id']]=row['weaponSkill'] or row['weapon']
            elif rule.get('expeditionSkillSlot'):skillmap[skill['id']]=row['expeditionSkills'][rule['expeditionSkillSlot']-1]
print('Matched heroes:',len(heroes),'unique assets:',len(assets),flush=True)
failures=[]
with ThreadPoolExecutor(max_workers=4) as pool:
    jobs={pool.submit(fetch,url,OUT/entry['path'].rsplit('/',1)[-1]):url for url,entry in assets.items()}
    for job in as_completed(jobs):
        try:job.result()
        except Exception as e:failures.append(str(e))
if failures:raise RuntimeError('\n'.join(failures))
for entry in assets.values():
    data=(ROOT/'public'/entry['path']).read_bytes()
    assert data[:4]==b'RIFF' and data[8:12]==b'WEBP',entry['path']
    entry['sha256']=hashlib.sha256(data).hexdigest()
manifest={'source':BASE+'/zh-CN/heroes/','heroes':dict(sorted(heroes.items())),'skills':dict(sorted(skillmap.items()))}
p=OUT/'manifest.json';p.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
(OUT/'SOURCES.md').write_text('# Hero artwork\n\nSource: https://wos.h5joy-games.com/zh-CN/heroes/\n\nCommunity reference artwork, downloaded for local display. Game character, skill, and equipment images belong to their respective rights holders. No game mechanics or numerical values are imported. Per-file source URLs and SHA-256 hashes are recorded in `public/assets/heroes/manifest.json`.\n',encoding='utf-8')
uiheroes={hid:{'portrait':row['portrait']['path'],'weapon':row['weapon']['path'],'weaponName':row['weapon']['name'],'skills':[a['path'] for a in row['expeditionSkills']]} for hid,row in sorted(heroes.items())}
uiskills={sid:{'path':a['path'],'name':a['name']} for sid,a in sorted(skillmap.items())}
p=ROOT/'src/ui/data/heroArtData.ts';p.parent.mkdir(parents=True,exist_ok=True)
p.write_text('// Generated by scripts/import-hero-art.py. Display assets only.\nexport const HERO_ART: Readonly<Record<string, { portrait: string; weapon: string; weaponName: string; skills: readonly string[] }>> = '+json.dumps(uiheroes,ensure_ascii=False,indent=2)+';\nexport const SKILL_ART: Readonly<Record<string, { path: string; name: string }>> = '+json.dumps(uiskills,ensure_ascii=False,indent=2)+';\n',encoding='utf-8')
print('Imported',len(assets),'verified WebP files; bytes:',sum(p.stat().st_size for p in OUT.glob('*.webp')),flush=True)

