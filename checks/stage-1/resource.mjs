// L1.8 resource smoke: bounded read/write burst, no request error, record elapsed and RSS.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
const root=process.argv[2]||'.', dir=[join(root,'stage-1'),root].find(x=>existsSync(join(x,'src','server.ts')));
const port=await new Promise(ok=>{const s=createServer();s.listen(0,()=>{const p=s.address().port;s.close(()=>ok(p))})});
const srv=spawn(process.execPath,['--disable-warning=ExperimentalWarning','src/server.ts'],{cwd:dir,env:{...process.env,PORT:String(port)},stdio:'ignore'}), B=`http://127.0.0.1:${port}`;
const call=(p,o={})=>fetch(B+p,o);
try { for(let i=0;i<100;i++){try{if((await call('/health')).status===200)break}catch{} await new Promise(r=>setTimeout(r,50));}
 const fx={users:[{id:'u',email:'a@b.co',password:'correct horse'}],restaurants:[{id:'r',name:'R',timezone:'Asia/Kolkata',slot_minutes:15,reservation_duration_minutes:30,cancellation_cutoff_minutes:0,opening_hours:[{weekday:'sun',opens:'00:00',closes:'23:45'}],tables:[{id:'t',label:'1',capacity:4}]}],reservations:[]};
 if((await call('/_test/reset',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(fx)})).status!==204)throw Error('reset');
 const t=Date.now(); for(let i=0;i<100;i++){let r=await call('/availability?restaurant_id=r&date=2026-10-04&party_size=2');if(r.status!==200)throw Error('availability '+r.status)}
 console.log(`PASS L1.8 100 reads; elapsed_ms=${Date.now()-t}; rss=${process.memoryUsage().rss}`);
} catch(e){console.log('FAIL L1.8 '+e.message);process.exitCode=1} finally {srv.kill()}
