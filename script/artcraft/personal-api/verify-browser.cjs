const {chromium}=require(process.env.ARTCRAFT_PLAYWRIGHT || require('node:path').resolve('frontend/node_modules/playwright'));
const fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.ARTCRAFT_CHROMIUM || undefined,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu-sandbox','--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[];const calls=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text().slice(0,300));});
 await page.addInitScript(()=>{
  const callbacks=new Map();let count=1;
  const success=p=>({status:'success',payload:p});
  const model={model:'gpt_image_2p5_sunburst',model_creator:'open_ai',full_name:'GPT Image 2.5',text_prompt_supported:true,image_refs_supported:true,image_refs_max:16,aspect_ratio_options:['auto','square','wide','tall'],aspect_ratio_default:'square',resolution_options:['one_k','two_k','four_k'],resolution_default:'one_k',batch_size_options:[1,2,3,4],batch_size_max:4,batch_size_default:1,quality_options:['auto','high'],default_quality:'auto'};
  const user={user_token:'local_desktop',username:'local',display_name:'Personal workspace',can_access_studio:true};
  window.__qaCalls=[];
  window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
  window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:(c,once)=>{const id=count++;callbacks.set(id,c);return id;},unregisterCallback:id=>callbacks.delete(id),runCallback:(id,data)=>callbacks.get(id)?.(data),invoke:async(cmd,args={})=>{
    window.__qaCalls.push(cmd);
    if(cmd==='get_app_info_command')return success({artcraft_version:'0.42.1 Personal API',storyteller_host:'https://personal.artcraft.local',artcraft_root_directory:'/fixtures',download_directory:'/downloads'});
    if(cmd==='get_app_preferences_command')return {preferences:{preferred_download_directory:{system:'downloads'},preferred_download_filename:'artcraft_convention',auto_download:false,play_sounds:false}};
    if(cmd==='get_task_queue_command')return success({tasks:[]});
    if(cmd==='storyteller_get_credits_command')return success({free_credits:0,monthly_credits:0,banked_credits:0,sum_total_credits:0});
    if(cmd==='storyteller_get_subscription_command')return success({});
    if(cmd==='list_image_models_command')return success({success:true,models:[model],providers:[{provider:'artcraft',models:[{model:model.model}]}]});
    if(cmd==='list_video_models_command')return success({success:true,models:[{model:'seedance_2p5',model_creator:'bytedance',full_name:'Seedance 2.5',text_prompt_supported:true,text_to_video_supported:true,duration_seconds_min:4,duration_seconds_max:30,duration_seconds_default:5,aspect_ratio_options:['wide','tall','square'],resolution_options:['seven_twenty_p','ten_eighty_p'],image_references_supported:true,image_references_max:30,video_references_supported:true,video_references_max:10,audio_references_max:10,starting_keyframe_supported:true,ending_keyframe_supported:true}],providers:[{provider:'artcraft',models:[{model:'seedance_2p5'}]}]});
    if(cmd.startsWith('estimate_'))return success({success:true,cost_in_credits:null,is_free:false,is_unlimited:false});
    if(cmd==='personal_api_request_command'){
      const p=new URL(args.request.url).pathname;
      if(p==='/v1/session')return {success:true,logged_in:true,user};
      if(p.includes('active_subscriptions'))return {success:true,active_subscriptions:[]};
      if(p.startsWith('/v1/omni_gen/models/audio'))return {success:true,models:[{model:'qwen3-tts-flash',full_name:'Qwen TTS',model_creator:'alibaba',text_prompt_supported:true}],providers:[]};
      return {success:true,results:[],jobs:[],prompts:[],media_files:[],pagination:{total_page_count:0}};
    }
    if(cmd==='personal_get_settings_command')return Object.fromEntries(['image','video','audio'].map(kind=>[kind,{baseUrl:'https://api.example.com/v1',model:{image:'gpt-image-2.5-sunburst',video:'doubao-seedance-2-5-260628',audio:'qwen3-tts-flash'}[kind],voice:'Cherry',language:'Chinese',editFormat:'json',hasKey:false}]));
    if(cmd==='plugin:event|listen')return count++;
    if(cmd.includes('is_maximized'))return false;
    return success({});
  }};
 });
 await page.goto(process.env.ARTCRAFT_BROWSER_URL || 'http://127.0.0.1:5188/',{waitUntil:'domcontentloaded'});await page.waitForTimeout(5000);
 await page.screenshot({path:require('node:path').resolve('.local-qa/personal-api/home.png'),fullPage:true});
 console.log(JSON.stringify({errors,calls:await page.evaluate(()=>window.__qaCalls),buttons:await page.getByRole('button').allTextContents()}));
 await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Personal APIs',exact:true}).click();
 await page.waitForTimeout(400);await page.screenshot({path:require('node:path').resolve('.local-qa/personal-api/settings.png')});
 console.log('FINAL_ERRORS',JSON.stringify(errors));
 await page.keyboard.press('Escape');
 const home = async()=>{await page.locator('nav button').first().click();await page.mouse.move(1200,100);await page.waitForTimeout(800);};
 const open = async(name)=>{await home();await page.getByRole('main').getByRole('button',{name}).click();await page.waitForTimeout(1400);};
 await open(/^Create Image/);await page.screenshot({path:require('node:path').resolve('.local-qa/personal-api/image.png')});console.log('IMAGE_BODY',await page.locator('body').innerText());console.log('EDITABLES',await page.locator('textarea,[contenteditable]').evaluateAll(els=>els.map(e=>({tag:e.tagName,attrs:e.outerHTML.slice(0,300)}))));
 await page.locator('[contenteditable=true],textarea').first().fill('A fixture image');
 await page.screenshot({path:require('node:path').resolve('.local-qa/personal-api/image.png')});
 await open(/^Create Video/);await page.screenshot({path:require('node:path').resolve('.local-qa/personal-api/video.png')});
 await open(/^Create Audio/);await page.locator('textarea,[contenteditable=true]').first().fill('你好，这是原版界面测试');
 await page.screenshot({path:require('node:path').resolve('.local-qa/personal-api/audio.png')});
 await open(/^Image Editor/);await page.getByText('Blank Canvas',{exact:true}).click();await page.getByRole('button',{name:'512 × 512',exact:true}).click();await page.getByRole('button',{name:'Create Canvas',exact:true}).click();
 await page.locator('canvas').first().waitFor();await page.waitForTimeout(600);
 const pixels=()=>page.locator('canvas').evaluateAll(cs=>cs.reduce((n,c)=>{const ctx=c.getContext('2d');if(!ctx)return n;const d=ctx.getImageData(0,0,c.width,c.height).data;for(let i=0;i<d.length;i+=4)if(d[i+3]>0&&(d[i]<225||d[i+1]<225||d[i+2]<225))n++;return n;},0));
 const before=await pixels();await page.keyboard.press('3');const box=await page.locator('canvas').first().boundingBox();await page.mouse.move(box.x+box.width*.45,box.y+box.height*.45);await page.mouse.down();await page.mouse.move(box.x+box.width*.5+70,box.y+box.height*.5+50,{steps:20});await page.mouse.up();await page.waitForTimeout(400);
 const painted=await pixels();console.log('PIXELS',before,painted);if(painted<=before+100){await page.screenshot({path:require('node:path').resolve('.local-qa/personal-api/failure.png')});throw new Error('Original canvas brush did not draw');}
 await page.screenshot({path:require('node:path').resolve('.local-qa/personal-api/canvas-painted.png')});
 await open(/^3D Stage/);await page.screenshot({path:require('node:path').resolve('.local-qa/personal-api/scene-failure.png')});console.log('SCENE_ERRORS',JSON.stringify(errors));console.log('SCENE_BODY',await page.locator('body').innerText());await page.locator('#video-scene-container canvas').first().waitFor();await page.waitForTimeout(1300);await page.screenshot({path:require('node:path').resolve('.local-qa/personal-api/scene.png')});
 console.log('EDITOR_CHECKS',JSON.stringify({before,painted,errors}));
 await browser.close();
})().catch(e=>{console.error(e);process.exitCode=1});
