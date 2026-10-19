import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../static/app.js',import.meta.url),'utf8');
const utilities=source.slice(source.indexOf('const esc ='),source.indexOf('const statusLabel ='));
const contact=source.slice(source.indexOf('function driverContactHtml('),source.indexOf('function driverNextStopHtml('));
const context=vm.createContext({});
vm.runInContext(utilities+'\n'+contact,context);
const html=stop=>context.driverContactHtml(stop);

test('motorista vê responsável, cargo, telefone e WhatsApp cadastrado',()=>{
 const result=html({contact_name:'Ana',contact_role:'Síndica',phone:'(15) 99999-8888',whatsapp:true});
 assert.match(result,/Ana/);assert.match(result,/Síndica/);
 assert.match(result,/href="tel:15999998888"/);assert.match(result,/href="https:\/\/wa.me\/5515999998888"/);
});
test('sem WhatsApp ou telefone válido não cria conversa ou link vazio',()=>{
 assert.doesNotMatch(html({phone:'(15) 3333-2222',whatsapp:false}),/wa.me/);
 const missing=html({whatsapp:true,phone:'--'});
 assert.match(missing,/Responsável:<\/strong> Não informado/);assert.match(missing,/Telefone não informado/);
 assert.doesNotMatch(missing,/href=/);
});
test('DDD 55 local e código internacional 55 são preservados',()=>{
 assert.match(html({phone:'(55) 99999-8888',whatsapp:true}),/wa.me\/5555999998888/);
 assert.match(html({phone:'+55 (15) 99999-8888',whatsapp:true}),/wa.me\/5515999998888/);
});
test('dados do responsável são texto e não podem inserir HTML',()=>{
 const result=html({contact_name:'<img src=x onerror=alert(1)>',contact_role:'A & B'});
 assert.doesNotMatch(result,/<img/);assert.match(result,/&lt;img/);assert.match(result,/A &amp; B/);
});
