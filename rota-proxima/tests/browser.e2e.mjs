import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from '@playwright/test';
const port=19365;
const child=spawn(process.env.PYTHON||'python',['-u','server_final.py'],{
 cwd:new URL('..',import.meta.url),env:{...process.env,ROTA_HOST:'127.0.0.1',ROTA_PORT:String(port),PORT:String(port)},stdio:'pipe'});
let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
let browser;
try{
 for(let i=0;i<80;i++){try{await fetch(`http://127.0.0.1:${port}/api/health`);break;}catch{}await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||undefined,
  args:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--disable-software-rasterizer','--single-process','--no-zygote']:undefined});
 const context=await browser.newContext({viewport:{width:1440,height:900},serviceWorkers:'block',timezoneId:'America/Sao_Paulo'});
 const page=await context.newPage();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let currentUser=null;const calls=[];let reorderBody=null;
 const pevs=Array.from({length:35},(_,i)=>({id:i+1,name:`PEV ${String(i+1).padStart(2,'0')}`,street:'Rua de teste',number:'10',city:'Sorocaba',state:'SP',lat:-23.5,lng:-47.4,location_confirmed:true,drum_installed:i===0,default_priority:'normal'}));
 const requests=[{id:50,pev_id:30,pev_name:'PEV 30',status:'pending',priority:'normal',requested_date:'2026-10-20',requested_by_name:'Comercial',city:'Sorocaba',state:'SP'}];
 let route={id:99,name:'Rota de teste',driver_id:'driver-1',driver_name:'Motorista',status:'in_progress',route_date:'2026-10-20',origin:{lat:-23.5,lng:-47.4},total_distance_m:1000,total_duration_s:120,evidences:[],weighings:[],timeline:[],stops:[
  {id:101,sequence:1,pev_id:1,pev_name:'Já concluída',status:'completed',service_type:'delivery',street:'Rua A',city:'Sorocaba',state:'SP',priority:'normal',lat:-23.5,lng:-47.4},
  {id:102,sequence:2,pev_id:2,pev_name:'Bella',status:'pending',service_type:'collection',street:'Rua B',city:'Sorocaba',state:'SP',priority:'normal',lat:-23.5,lng:-47.4,contact_name:'Ana Responsável',contact_role:'Síndica',phone:'(15) 99999-8888',whatsapp:true},
  {id:103,sequence:3,pev_id:3,pev_name:'CHS',status:'pending',service_type:'delivery',street:'Rua C',city:'Sorocaba',state:'SP',priority:'normal',lat:-23.5,lng:-47.4,contact_name:'Carlos',phone:'(15) 3333-2222',whatsapp:false}]};
 await page.route('**/api/**',async intercept=>{
  const request=intercept.request(),url=new URL(request.url()),path=url.pathname;calls.push(path);
  let json={ok:true};
  if(path==='/api/me')json={user:currentUser};
  else if(path==='/api/setup-status')json={needs_setup:false};
  else if(path==='/api/pevs')json={items:pevs};
  else if(path==='/api/drivers')json={items:[{id:'driver-1',name:'Motorista'}]};
  else if(path==='/api/requests')json={items:requests};
  else if(path==='/api/dashboard')json={pending_requests:1,unconfirmed_locations:0,routes:[]};
  else if(path==='/api/routes/99/reorder'){
   reorderBody=request.postDataJSON();
   const byId=Object.fromEntries(route.stops.map(s=>[s.id,s]));
   route={...route,stops:[route.stops[0],...reorderBody.stop_ids.map((id,index)=>({...byId[id],sequence:index+2}))]};json=route;
  }
  else if(path==='/api/routes/99')json=route;
  else if(path==='/api/routes'&&request.method()==='POST')json={id:99};
  else if(path==='/api/routes')json={items:[route]};
  else if(path==='/api/optimize'){
   const body=request.postDataJSON();json={total_distance_m:1000,total_duration_s:120,source:'osrm',stops:body.stops.map((stop,i)=>({...stop,pev:pevs.find(p=>p.id===stop.pev_id),sequence:i+1,distance_m:500,duration_s:60}))};
  }
  await intercept.fulfill({json});
 });
 const base=`http://127.0.0.1:${port}`;
 await page.goto(base);await page.locator('#loginForm').waitFor({state:'visible'});
 assert.ok(calls.includes('/api/me'));assert.ok(calls.includes('/api/setup-status'));
 assert.equal(await page.locator('.cassola-hero-photo img').getAttribute('src'),'/cassola-login-hero-approved.webp?v=login-images-20260916-11');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 if(process.env.ROTA_QA_SCREENSHOTS)await page.screenshot({path:process.env.ROTA_QA_SCREENSHOTS+'/login-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});
 assert.equal(await page.locator('#loginUsername').isVisible(),true);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 assert.equal(await page.locator('.cassola-auth-visual').isVisible(),false);
 if(process.env.ROTA_QA_SCREENSHOTS)await page.screenshot({path:process.env.ROTA_QA_SCREENSHOTS+'/login-mobile.png',fullPage:true});
 await page.setViewportSize({width:1440,height:900});currentUser={id:'admin-1',name:'Administrador',username:'admin',role:'admin',must_change_password:false};
 await page.reload();await page.locator('#appShell').waitFor({state:'visible'});
 assert.equal(await page.locator('#authScreen').isVisible(),false); // Existing session survives a reload.
 await page.evaluate(()=>go('requests'));await page.locator('.request-select').waitFor();
 const size=await page.locator('.request-select').evaluate(el=>({height:el.offsetHeight,width:el.offsetWidth,padding:getComputedStyle(el).padding}));
 assert.ok(size.height<=20&&size.width<=20);assert.equal(size.padding,'0px');
 await page.locator('.request-select').check();await page.locator('#planSelectedRequests').click();
 await page.locator('#selectedPevs .pev-check').waitFor();
 assert.equal(await page.locator('#selectedPevs .name').textContent(),'PEV 30');
 assert.equal(await page.locator('#selectedPevs .pev-service-type').inputValue(),'delivery');
 assert.equal(await page.locator('#pevSelector .pev-service-type[data-id="1"]').inputValue(),'collection');
 await page.locator('#selectSearch').fill('PEV 35');await page.locator('#pevSelector input[type="checkbox"][data-id="35"]').click();
 assert.equal(await page.locator('#selectedPevs .pev-check').count(),2);
 assert.equal(await page.locator('#selectedPevs .pev-service-type[data-id="30"]').isVisible(),true);
 await page.locator('#selectedPevs .pev-service-type[data-id="30"]').selectOption('collection');
 await page.locator('#routeDriver').selectOption('driver-1');await page.locator('#bestOptimize').click();
 await page.locator('#saveDraft').waitFor();assert.equal(await page.getByRole('button',{name:'Criar rota',exact:true}).count(),1);
 assert.equal(await page.locator('#nearestOptimize').count(),0);
 if(process.env.ROTA_QA_SCREENSHOTS)await page.screenshot({path:process.env.ROTA_QA_SCREENSHOTS+'/planner.png',fullPage:true});
 console.log('Planejamento aprovado.');await page.locator('#saveDraft').click();await page.locator('#modal[open]').waitFor();

 await page.locator('#modal .route-drag-handle').first().waitFor();
 assert.equal(await page.locator('#modal .route-drag-handle').count(),2);
 console.log('Modal pronto para reordenação.');await page.locator('#modal .route-drag-handle').first().press('ArrowDown');
 await page.waitForFunction(()=>document.querySelector('#modal .route-preview').textContent.indexOf('CHS')<document.querySelector('#modal .route-preview').textContent.indexOf('Bella'));
 assert.deepEqual(reorderBody.stop_ids,[103,102]);assert.deepEqual(reorderBody.expected_ids,[102,103]);
 assert.equal(await page.locator('#modal .route-stop').first().textContent().then(s=>s.includes('Já concluída')),true);
 console.log('Reordenação por teclado aprovada.');await page.locator('#modal .modal-close').first().click();
 await page.evaluate(()=>{state.user={id:'driver-1',name:'Motorista',username:'driver',role:'driver'};return go('driver');});
 await page.locator('.driver-sequence-card .route-drag-handle').first().waitFor();
 assert.match(await page.locator('.next-stop .driver-contact').textContent(),/Carlos/);
 assert.equal(await page.locator('.next-stop .driver-contact-whatsapp').count(),0);
 assert.equal(await page.locator('.driver-sequence-card .driver-contact-whatsapp').getAttribute('href'),'https://wa.me/5515999998888');
 const handles=page.locator('.driver-sequence-card .route-drag-handle');
 console.log('Motorista pronto para arraste.');await handles.last().scrollIntoViewIfNeeded();const first=await handles.first().boundingBox(),last=await handles.last().boundingBox();
 await page.mouse.move(first.x+first.width/2,first.y+first.height/2);await page.mouse.down();
 await page.mouse.move(last.x+last.width/2,last.y+last.height/2,{steps:8});await page.mouse.up();
 await page.waitForFunction(()=>document.querySelector('.driver-sequence-card').textContent.indexOf('Bella')<document.querySelector('.driver-sequence-card').textContent.indexOf('CHS'));
 assert.deepEqual(reorderBody.stop_ids,[102,103]);
 assert.match(await page.locator('.next-stop .driver-contact').textContent(),/Ana Responsável/);
 assert.equal(await page.locator('.next-stop .driver-contact-whatsapp').getAttribute('href'),'https://wa.me/5515999998888');
 await page.setViewportSize({width:390,height:844});
 assert.equal(await page.locator('.next-stop .driver-contact-whatsapp').isVisible(),true);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.evaluate(route=>drawDriverRoute({...route,status:'released'}),route);
 assert.equal(await page.locator('.driver-sequence-card .driver-contact-whatsapp').isVisible(),true);
 assert.equal(errors.length,0,errors.join('\n'));
 // Validate the generated ZIP against Python's standard reader (including UTF-8 names and CRC).
 const archive=await page.evaluate(async()=>[...new Uint8Array(await backupZip([{name:'evidências/teste.txt',bytes:new TextEncoder().encode('Arquivo íntegro')}]).arrayBuffer())]);
 const zipPath=join(tmpdir(),`rota-backup-test-${process.pid}.zip`);
 fs.writeFileSync(zipPath,Buffer.from(archive));
 const checked=spawnSync(process.env.PYTHON||'python',['-c',"import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; assert z.read('evidências/teste.txt').decode()=='Arquivo íntegro'",zipPath]);
 assert.equal(checked.status,0,checked.stderr.toString());fs.unlinkSync(zipPath);
 console.log('E2E aprovado: sessão, login desktop/mobile, solicitações, seleção fixada, Entrega/Coleta, botão único, teclado e arraste, ZIP.');
} catch(error){console.error(output.slice(-1000));console.error('E2E falhou:',error.message);throw error;}
finally{await browser?.close();child.kill();}
