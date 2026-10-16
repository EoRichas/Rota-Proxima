import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {PGlite} from '@electric-sql/pglite';
const fixture=fs.readFileSync(new URL('./fixtures/migration_base.sql',import.meta.url),'utf8');
const upgrade=fs.readFileSync(new URL('../supabase/migrations/20261016183641_route_precision_drum_inventory_and_durable_evidence_sync.sql',import.meta.url),'utf8');
const uuid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
async function database(){const db=new PGlite();await db.exec(fixture);await db.exec(upgrade);return db;}
async function actor(db,n,role='authenticated'){
 await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[n?uuid(n):'',JSON.stringify({role})]);
 await db.exec(`set role ${role}`);
}
const payload=JSON.stringify([{id:3,sequence:2,planned_distance_m:4,planned_duration_s:5},{id:2,sequence:3,planned_distance_m:6,planned_duration_s:7}]);
test('migração preserva tambor de PEV atendido e deixa novo como Entrega',async()=>{
 const db=await database();try{const {rows}=await db.query('select id,drum_installed from pevs order by id');assert.deepEqual(rows,[{id:1,drum_installed:false},{id:2,drum_installed:true}]);}finally{await db.close();}
});
test('motorista reordena apenas pendentes; conclusão e histórico ficam preservados',async()=>{
 const db=await database();try{await actor(db,2);await db.query('select public.reorder_pending_stops(1,$1::bigint[],$2::jsonb)',[[2,3],payload]);await db.exec('reset role');const {rows}=await db.query('select id,sequence,status from route_stops order by sequence');assert.deepEqual(rows,[{id:1,sequence:1,status:'completed'},{id:3,sequence:2,status:'pending'},{id:2,sequence:3,status:'pending'}]);assert.equal((await db.query("select count(*)::int as n from audit_logs where action='manual_reorder'")).rows[0].n,1);}finally{await db.close();}
});
test('outro motorista e Qualidade não conseguem reordenar',async()=>{
 const db=await database();try{for(const n of [3,4]){await actor(db,n);await assert.rejects(db.query('select public.reorder_pending_stops(1,$1::bigint[],$2::jsonb)',[[2,3],payload]));await db.exec('reset role');}}finally{await db.close();}
});
test('ordem repetida ou desatualizada é recusada sem alterar a rota',async()=>{
 const db=await database();try{await actor(db,2);await assert.rejects(db.query('select public.reorder_pending_stops(1,$1::bigint[],$2::jsonb)',[[3,2],payload]),/mudou/);await assert.rejects(db.query('select public.reorder_pending_stops(1,$1::bigint[],$2::jsonb)',[[2,3],JSON.stringify([{id:2,sequence:2},{id:2,sequence:3}])]),/inválidas/);}finally{await db.close();}
});
test('fila só permite ao autor reservar a evidência e não a reserva duas vezes',async()=>{
 const db=await database();try{await actor(db,3);assert.equal((await db.query('select * from public.claim_evidence_sync()')).rows.length,0);await db.exec('reset role');await actor(db,2);assert.equal((await db.query('select * from public.claim_evidence_sync()')).rows.length,1);assert.equal((await db.query('select * from public.claim_evidence_sync()')).rows.length,0);await db.query("select public.fail_evidence_sync(1,'rede indisponível')");await db.exec('reset role');const e=(await db.query('select sharepoint_status,next_retry_at>now() as backoff from route_evidences')).rows[0];assert.equal(e.sharepoint_status,'error');assert.equal(e.backoff,true);}finally{await db.close();}
});
test('service_role retoma reserva abandonada; autor desativado perde acesso',async()=>{
 const db=await database();try{await db.exec("update route_evidences set sharepoint_status='syncing',sharepoint_started_at=now()-interval '11 minutes'");await actor(db,null,'service_role');assert.equal((await db.query('select * from public.claim_evidence_sync()')).rows.length,1);await db.exec('reset role');await db.exec(`update profiles set active=false where id='${uuid(2)}'`);await actor(db,2);await assert.rejects(db.query('select * from public.claim_evidence_sync()'),/permissão/);}finally{await db.close();}
});
test('somente Admin pode liberar erros esgotados para nova tentativa',async()=>{
 const db=await database();try{await db.exec("update route_evidences set sharepoint_status='error',sharepoint_attempts=8,next_retry_at=now()+interval '1 day'");await actor(db,2);await assert.rejects(db.query('select public.reset_failed_evidence_sync()'),/permissão/);await db.exec('reset role');await actor(db,1);await db.query('select public.reset_failed_evidence_sync()');assert.equal((await db.query('select * from public.claim_evidence_sync()')).rows.length,1);}finally{await db.close();}
});
test('confirmação de sincronização aceita serviço e nega outro motorista',async()=>{
 const db=await database();try{await actor(db,3);await assert.rejects(db.query("select public.update_own_evidence_sync(1,'synced')"),/permissão/);await db.exec('reset role');await actor(db,null,'service_role');await db.query("select public.update_own_evidence_sync(1,'synced','remote-id')");await db.exec('reset role');assert.equal((await db.query('select sharepoint_status from route_evidences')).rows[0].sharepoint_status,'synced');}finally{await db.close();}
});
