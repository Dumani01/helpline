process.env.DATABASE_FILE=':memory:';
process.env.AUTH_USERNAME='test-admin';
process.env.AUTH_PASSWORD='test-password-123';
process.env.AUTH_SECRET='test-session-secret-that-is-at-least-32-bytes-long';

import { test,after,before } from 'node:test';
import assert from 'node:assert/strict';
const {app}=await import('../src/app.js');
const {db,normalizeUtcDates}=await import('../src/db.js');
const server=app.listen(0);
after(()=>server.close());
let cookie='';
before(async()=>{const res=await fetch(`http://127.0.0.1:${server.address().port}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:process.env.AUTH_USERNAME,password:process.env.AUTH_PASSWORD})});assert.equal(res.status,200);cookie=res.headers.get('set-cookie').split(';')[0];});
const api=async(method,path,body,session=cookie)=>{const headers={'Content-Type':'application/json','X-Requested-With':'XMLHttpRequest'};if(session)headers.Cookie=session;const res=await fetch(`http://127.0.0.1:${server.address().port}/api${path}`,{method,headers,body:body?JSON.stringify(body):undefined});return {status:res.status,data:res.status===204?null:await res.json()};};
test('autenticación protege la API y permite cerrar sesión',async()=>{
 assert.equal((await api('GET','/tickets',undefined,'')).status,401);
 assert.equal((await api('POST','/auth/login',{username:'test-admin',password:'incorrecta'},'')).status,401);
 const login=await fetch(`http://127.0.0.1:${server.address().port}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'test-admin',password:'test-password-123'})});
 assert.equal(login.status,200);
 const setCookie=login.headers.get('set-cookie');
 assert.match(setCookie,/HttpOnly/);
 assert.match(setCookie,/SameSite=Strict/);
 const temporaryCookie=setCookie.split(';')[0];
 assert.equal((await api('GET','/auth/session',undefined,temporaryCookie)).data.username,'test-admin');
 assert.equal((await api('POST','/auth/logout',undefined,temporaryCookie)).status,204);
 assert.equal((await api('GET','/tickets',undefined,temporaryCookie)).status,401);
 const blocked=await fetch(`http://127.0.0.1:${server.address().port}/api/tickets`,{headers:{Origin:'https://malicious.example'}});
 assert.equal(blocked.status,403);
});
test('las fechas se guardan en UTC y un ticket dentro del plazo cumple SLA',async()=>{
 db.prepare("UPDATE tickets SET fecha_creacion='2026-10-22 12:34:56',fecha_limite='2026-10-22 16:34:56' WHERE id=1").run();
 normalizeUtcDates();
 const seeded=db.prepare('SELECT fecha_creacion,fecha_limite FROM tickets WHERE id=1').get();
 assert.match(seeded.fecha_creacion,/^\d{4}-\d{2}-\d{2}T.*Z$/);
 assert.match(seeded.fecha_limite,/^\d{4}-\d{2}-\d{2}T.*Z$/);
 assert.equal(seeded.fecha_creacion,'2026-10-22T12:34:56.000Z');
 const future=new Date(Date.now()+60*60*1000).toISOString();
 db.prepare('UPDATE tickets SET fecha_limite=?').run(future);
 assert.equal((await api('GET','/resumen')).data.cumplimientoSla,100);
 const created=await api('POST','/tickets',{cliente_id:1,titulo:'Prueba SLA vigente',descripcion:'Debe permanecer dentro del plazo.',area:'software',prioridad:'alta'});
 assert.equal(created.status,201);
 assert.match(created.data.fecha_creacion,/^\d{4}-\d{2}-\d{2}T.*Z$/);
 assert.match(created.data.fecha_limite,/^\d{4}-\d{2}-\d{2}T.*Z$/);
 assert.ok(Date.parse(created.data.fecha_limite)>Date.now());
 const summary=await api('GET','/resumen');
 assert.equal(summary.data.cumplimientoSla,100);
 assert.equal(summary.data.vencidos,0);
 await api('DELETE',`/tickets/${created.data.id}`);
});
test('resumen y recursos existentes',async()=>{const r=await api('GET','/resumen');assert.equal(r.status,200);assert.ok(r.data.total>=3);assert.equal((await api('GET','/tickets/999999')).status,404);});
test('CRUD de clientes, errores 400, 404, 409',async()=>{
 assert.equal((await api('POST','/clientes',{nombre:''})).status,400);
 const r=await api('POST','/clientes',{nombre:'Demo',empresa:'Pruebas'});assert.equal(r.status,201);
 assert.equal((await api('PUT',`/clientes/${r.data.id}`,{nombre:'Demo Editado',empresa:'Pruebas'})).data.nombre,'Demo Editado');
 assert.equal((await api('DELETE',`/clientes/${r.data.id}`)).status,200);
 assert.equal((await api('DELETE',`/clientes/${r.data.id}`)).status,404);
 assert.equal((await api('DELETE','/clientes/1')).status,409);
});
test('ticket, transiciones, asignación y auditoría',async()=>{
 const r=await api('POST','/tickets',{cliente_id:1,titulo:'Prueba SLA',descripcion:'Revisión',area:'software',prioridad:'alta'});assert.equal(r.status,201);
 const id=r.data.id;
 assert.equal((await api('PATCH',`/tickets/${id}/estado`,{estado:'cerrado'})).status,409);
 assert.equal((await api('POST',`/tickets/${id}/asignar`)).status,200);
 assert.equal((await api('PATCH',`/tickets/${id}/estado`,{estado:'resuelto'})).status,409);
 assert.equal((await api('POST',`/tickets/${id}/comentarios`,{autor:'Técnico',texto:'Se reparó el problema',tipo:'resolucion'})).status,201);
 assert.equal((await api('PATCH',`/tickets/${id}/estado`,{estado:'resuelto'})).status,200);
 const detail=await api('GET',`/tickets/${id}`);assert.equal(detail.data.estado,'resuelto');assert.ok(detail.data.historial.length>=3);
 assert.equal((await api('PATCH',`/tickets/${id}/estado`,{estado:'cerrado'})).status,200);
 assert.equal((await api('DELETE',`/tickets/${id}`)).status,200);
});
test('solo envía a n8n los campos necesarios para analizar el ticket',async()=>{
 const beforeUrl=process.env.N8N_WEBHOOK_URL;
 const originalFetch=globalThis.fetch;
 process.env.N8N_WEBHOOK_URL='http://localhost:5678/webhook/soporte-ia';
 let forwarded;
 globalThis.fetch=async(input,init)=>{if(String(input).startsWith('http://localhost:5678/')){forwarded=JSON.parse(init.body);return new Response(JSON.stringify({ok:true,data:{prioridad:'media',area:'software',respuesta:'Borrador de prueba'},error:null}),{status:200,headers:{'Content-Type':'application/json'}});}return originalFetch(input,init);};
 try {
  const response=await api('POST','/ia/analizar',{ticketId:1});
  assert.equal(response.status,200);
  assert.deepEqual(Object.keys(forwarded.ticket).sort(),['area','descripcion','id','prioridad','titulo']);
  assert.equal('comentarios' in forwarded.ticket,false);
  assert.equal('historial' in forwarded.ticket,false);
 } finally {
  globalThis.fetch=originalFetch;
  if(beforeUrl===undefined)delete process.env.N8N_WEBHOOK_URL;else process.env.N8N_WEBHOOK_URL=beforeUrl;
 }
});
