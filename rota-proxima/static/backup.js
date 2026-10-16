/* ZIP is assembled in the browser: large backups do not cross a function response.
   Every evidence must download successfully before the archive is offered. */
const BACKUP_CRC_TABLE=Array.from({length:256},(_,n)=>{
  for(let bit=0;bit<8;bit++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;
  return n>>>0;
});
function backupCrc32(bytes){let crc=0xffffffff;for(const byte of bytes)crc=BACKUP_CRC_TABLE[(crc^byte)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
function backupHeader(size){const bytes=new Uint8Array(size);return {bytes,view:new DataView(bytes.buffer)};}
function backupZip(entries){
  const parts=[],central=[];let offset=0;
  if(entries.length>65535)throw new Error('O backup excede o limite de arquivos do ZIP. Exporte pelo procedimento de infraestrutura.');
  for(const {name,bytes} of entries){
    const path=new TextEncoder().encode(name),crc=backupCrc32(bytes);
    if(offset+bytes.length>=0xffffffff)throw new Error('O backup excede 4 GB. Exporte pelo procedimento de infraestrutura.');
    const local=backupHeader(30);local.view.setUint32(0,0x04034b50,true);local.view.setUint16(4,20,true);local.view.setUint16(6,0x800,true);
    local.view.setUint32(14,crc,true);local.view.setUint32(18,bytes.length,true);local.view.setUint32(22,bytes.length,true);local.view.setUint16(26,path.length,true);
    const directory=backupHeader(46);directory.view.setUint32(0,0x02014b50,true);directory.view.setUint16(4,20,true);directory.view.setUint16(6,20,true);directory.view.setUint16(8,0x800,true);
    directory.view.setUint32(16,crc,true);directory.view.setUint32(20,bytes.length,true);directory.view.setUint32(24,bytes.length,true);directory.view.setUint16(28,path.length,true);directory.view.setUint32(42,offset,true);
    parts.push(local.bytes,path,bytes);central.push(directory.bytes,path);offset+=30+path.length+bytes.length;
  }
  const centralSize=central.reduce((sum,part)=>sum+part.length,0),end=backupHeader(22);
  end.view.setUint32(0,0x06054b50,true);end.view.setUint16(8,entries.length,true);end.view.setUint16(10,entries.length,true);end.view.setUint32(12,centralSize,true);end.view.setUint32(16,offset,true);
  return new Blob([...parts,...central,end.bytes],{type:'application/zip'});
}
async function downloadOperationalBackup(button){
  const label=button.textContent;button.disabled=true;
  const encode=value=>new TextEncoder().encode(JSON.stringify(value,null,2));
  try{
    button.textContent='Preparando backup...';
    const manifest=await api('/api/backup/manifest'),data={};
    for(const table of manifest.tables){
      button.textContent='Exportando dados operacionais...';let offset=0;data[table]=[];
      while(offset!==null){
        const page=await api(`/api/backup/table/${table}?offset=${offset}`);
        data[table].push(...page.items);offset=page.next_offset;
      }
    }
    const entries=[],files=[],seen=new Set();
    for(const evidence of data.route_evidences){
      if(seen.has(evidence.storage_path))continue;seen.add(evidence.storage_path);
      button.textContent=`Baixando foto ${files.length+1} de ${data.route_evidences.length}...`;
      const {url}=await api(`/api/backup/evidence/${evidence.id}`);
      const response=await fetch(url,{credentials:'omit',signal:AbortSignal.timeout(60000)});
      if(!response.ok)throw new Error(`Falha ao baixar a evidência ${evidence.id}. Nenhum backup incompleto será entregue.`);
      const bytes=new Uint8Array(await response.arrayBuffer());
      if(!bytes.length)throw new Error(`A evidência ${evidence.id} está vazia.`);
      const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
      if(evidence.sharepoint_sha256&&digest!==evidence.sharepoint_sha256)throw new Error(`Integridade da evidência ${evidence.id} não confere.`);
      const extension=String(evidence.storage_path).split('.').pop().replace(/[^a-z0-9]/gi,'')||'jpg';
      const name=`evidencias/${evidence.id}.${extension}`;entries.push({name,bytes});files.push({evidence_id:evidence.id,storage_path:evidence.storage_path,file:name,sha256:digest});
    }
    const {schema_sql,...summary}=manifest;
    entries.push({name:'dados.json',bytes:encode(data)},{name:'manifesto.json',bytes:encode({...summary,completed_at:new Date().toISOString(),files,counts:Object.fromEntries(Object.entries(data).map(([table,rows])=>[table,rows.length]))})});
    if(schema_sql)entries.push({name:'baseline.sql',bytes:new TextEncoder().encode(schema_sql)});
    button.textContent='Montando arquivo...';const blob=backupZip(entries),url=URL.createObjectURL(blob),anchor=document.createElement('a');
    anchor.href=url;anchor.download=`rota-proxima-backup-${new Date().toISOString().slice(0,10)}.zip`;document.body.appendChild(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
    toast(`Backup operacional exportado com ${files.length} fotos.`,'success');
  }finally{button.disabled=false;button.textContent=label;}
}
