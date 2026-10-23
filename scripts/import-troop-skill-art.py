from pathlib import Path
import subprocess,json,hashlib,concurrent.futures
from PIL import Image
rows=[('shield-dense-formation','密集战阵','2024/09/2024y09m11d_2007559448.jpg'),('shield-steel-guardian','钢铁守护','2024/09/2024y09m11d_200758848.jpg'),('shield-crystal-shield','烈晶盾牌','2024/07/2024y07m26d_1804275774.jpg'),('shield-lightforged-body','光铸之躯','2026/04/2026y04m27d_1815596095.jpg'),('lancer-charge','冲锋','2024/09/2024y09m11d_2008042401.jpg'),('lancer-ambush','奇袭','2024/09/2024y09m11d_2008065455.jpg'),('lancer-crystal-spear','炎晶战矛','2024/07/2024y07m26d_1813483881.jpg'),('lancer-crimson-field','炽红力场','2026/04/2026y04m27d_1816184663.jpg'),('marksman-remote-strike','远程打击','2024/09/2024y09m11d_2008117539.jpg'),('marksman-rapid-fire','连射','2024/09/2024y09m11d_2008150989.jpg'),('marksman-crystal-powder','燃晶火药','2024/07/2024y07m26d_1833297847.jpg'),('marksman-flame-impact','火焰冲击','2026/04/2026y04m27d_1816437444.jpg')]
out=Path('public/assets/troop-skills');out.mkdir(parents=True,exist_ok=True)
def fetch(row):
 id,name,url=row;src='https://img.altema.jp/whiteoutsurvival/uploads/'+url;p=out/(id+'.jpg')
 subprocess.run(['curl.exe','-f','-L','--retry','2','--max-time','35','-s',src,'-o',str(p)],check=True)
 im=Image.open(p);im.verify()
 return id,{'path':'assets/troop-skills/'+p.name,'name':name,'source':src,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool: assets=dict(pool.map(fetch,rows))
(out/'manifest.json').write_text(json.dumps(assets,ensure_ascii=False,indent=2),encoding='utf-8')
for id,t in [('shield-immortal-wall-t12','shield'),('lancer-radiant-formation-t12','lancer'),('marksman-blazing-star-t12','marksman')]: assets[id]={'path':f'assets/game-ui/t12-{t}-skill.png','name':{'shield':'不朽之壁','lancer':'烈辉战阵','marksman':'炽火燧星'}[t]}
Path('src/ui/data/troopSkillArtData.ts').write_text('export const TROOP_SKILL_ART: Readonly<Record<string,{path:string;name:string;source?:string;sha256?:string}>> = '+json.dumps(assets,ensure_ascii=False,indent=2)+';\n',encoding='utf-8')
print('Downloaded',len(rows),'troop skill images')
