"""Assert the shipped editors and styles match the pinned official source."""
import hashlib,json,pathlib,subprocess,sys
root=pathlib.Path(__file__).resolve().parents[3]
pin='d4e4ac69bbd93d237eaf5d0260bc6a5ff3a5e373'
prefixes=['frontend/libs/components/pagedraw/','frontend/libs/components/pagescene/','frontend/libs/components/video-editor/','frontend/apps/artcraft/app/src/styles/','frontend/apps/artcraft/app/src/pages/','frontend/libs/components/button/','frontend/libs/components/input/','frontend/libs/components/modal/']
allowed={'frontend/apps/artcraft/app/src/pages/MainApp.tsx','frontend/apps/artcraft/app/src/pages/PageScene/useTauriPageSceneAdapter.tsx'}
manifest=root/'docs/personal-api/original-ui.json'
def summarize(rows):
 groups={}
 for prefix in prefixes:
  selected=sorted((path,sha) for path,sha in rows if path.startswith(prefix) and path not in allowed and not path.endswith(".md"))
  digest=hashlib.sha256(''.join(path+' '+sha+'\n' for path,sha in selected).encode()).hexdigest()
  groups[prefix]={'files':len(selected),'sha256':digest}
 return groups
if '--record' in sys.argv:
 raw=subprocess.check_output(['git','ls-tree','-r',pin,'--',*prefixes],cwd=root,text=True)
 rows=[]
 for line in raw.splitlines():
  info,path=line.split('\t');rows.append((path,info.split()[2]))
 manifest.write_text(json.dumps({'official_commit':pin,'protected':summarize(rows),'account_and_transport_exceptions':sorted(allowed)},indent=2)+'\n')
else:
 paths=subprocess.check_output(['git','ls-files','--',*prefixes],cwd=root,text=True).splitlines()
 hashes=subprocess.check_output(['git','hash-object','--stdin-paths'],input='\n'.join(paths)+'\n',cwd=root,text=True).splitlines()
 actual=summarize(list(zip(paths,hashes)));expected=json.loads(manifest.read_text())['protected']
 assert actual==expected, 'Original editor/style source changed: '+json.dumps({k:v for k,v in actual.items() if v!=expected[k]})
 print(json.dumps({'passed':True,'protected_files':sum(v['files'] for v in actual.values()),'official_commit':pin}))
