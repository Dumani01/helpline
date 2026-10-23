import { db, transaction } from '../db.js';
export class HttpError extends Error { constructor(status,message) {super(message);this.status=status;} }
export const fail=(status,message)=>{throw new HttpError(status,message)};
const valid=(v)=>typeof v==='string'&&v.trim().length>0;
const now=()=>new Date().toISOString();
export const getOne=(table,id)=>db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
const tables=['clientes','agentes'];
export function listSimple(table){if(!tables.includes(table))fail(400,'Recurso inválido');return db.prepare(`SELECT * FROM ${table} ORDER BY id DESC`).all();}
export function writeSimple(table,id,body){
 if(!tables.includes(table))fail(400,'Recurso inválido');
 const fields=table==='clientes'?['nombre','empresa']:['nombre','area','activo'];
 if(!valid(body.nombre) || (table==='clientes'&&!valid(body.empresa)) || (table==='agentes'&&!['software','hardware','redes'].includes(body.area)))fail(400,'Campos obligatorios o área inválida');
 if(table==='agentes'&&body.activo!==undefined&&![0,1,true,false].includes(body.activo))fail(400,'Activo inválido');
 const data=fields.map(k=>k==='activo'?Number(body[k]??1):body[k]?.trim());
 if(id){if(!getOne(table,id))fail(404,'Registro no encontrado');db.prepare(`UPDATE ${table} SET ${fields.map(k=>`${k}=?`).join(',')} WHERE id=?`).run(...data,id);return getOne(table,id);}
 const result=db.prepare(`INSERT INTO ${table} (${fields.join(',')}) VALUES (${fields.map(()=>'?').join(',')})`).run(...data);return getOne(table,result.lastInsertRowid);
}
export function deleteSimple(table,id){if(!getOne(table,id))fail(404,'Registro no encontrado');try{db.prepare(`DELETE FROM ${table} WHERE id=?`).run(id);}catch(e){if(e.errcode===1811||/constraint/i.test(e.message))fail(409,'No se puede eliminar: el registro está relacionado con tickets');throw e;}}
const priorities={alta:4,media:24,baja:72};
export function detail(id){
 const ticket=db.prepare('SELECT t.*,c.nombre cliente_nombre,a.nombre agente_nombre FROM tickets t JOIN clientes c ON c.id=t.cliente_id LEFT JOIN agentes a ON a.id=t.agente_id WHERE t.id=?').get(id);
 if(!ticket)fail(404,'Ticket no encontrado');
 return {...ticket,comentarios:db.prepare('SELECT * FROM comentarios WHERE ticket_id=? ORDER BY id').all(id),historial:db.prepare('SELECT * FROM historial WHERE ticket_id=? ORDER BY id').all(id)};
}
export function listTickets(){return db.prepare('SELECT t.*,c.nombre cliente_nombre,a.nombre agente_nombre FROM tickets t JOIN clientes c ON c.id=t.cliente_id LEFT JOIN agentes a ON a.id=t.agente_id ORDER BY t.id DESC').all();}
const log=(id,field,before,after)=>db.prepare('INSERT INTO historial(ticket_id,campo,valor_anterior,valor_nuevo,fecha) VALUES (?,?,?,?,?)').run(id,field,before===null?null:String(before),String(after),now());
export function createTicket(body){
 if(!Number.isInteger(Number(body.cliente_id))||!getOne('clientes',body.cliente_id))fail(400,'Cliente inválido');
 if(!valid(body.titulo)||!valid(body.descripcion)||!['software','hardware','redes'].includes(body.area)||!Object.hasOwn(priorities,body.prioridad))fail(400,'Título, descripción, área o prioridad inválidos');
 const created=now(),deadline=new Date(Date.now()+priorities[body.prioridad]*3600000).toISOString();
 return transaction(()=>{const r=db.prepare('INSERT INTO tickets(cliente_id,titulo,descripcion,area,prioridad,estado,fecha_creacion,fecha_limite) VALUES (?,?,?,?,?,?,?,?)').run(body.cliente_id,body.titulo.trim(),body.descripcion.trim(),body.area,body.prioridad,'abierto',created,deadline);log(r.lastInsertRowid,'estado',null,'abierto');return detail(r.lastInsertRowid);});
}
export function updateTicket(id,body){
 return transaction(()=>{
  const old=detail(id); const allowed=['titulo','descripcion','area','prioridad'];
  for(const field of allowed)if(body[field]!==undefined){const value=body[field];if((field==='titulo'||field==='descripcion')&&!valid(value))fail(400,`${field} obligatorio`);if(field==='area'&&!['hardware','software','redes'].includes(value))fail(400,'Área inválida');if(field==='prioridad'&&!Object.hasOwn(priorities,value))fail(400,'Prioridad inválida');}
  if(old.estado==='cerrado')fail(409,'No se puede editar un ticket cerrado');
  for(const field of allowed)if(body[field]!==undefined&&body[field]!==old[field]){db.prepare(`UPDATE tickets SET ${field}=? WHERE id=?`).run(body[field],id);log(id,field,old[field],body[field]);}
  if(body.prioridad&&body.prioridad!==old.prioridad){const deadline=new Date(new Date(old.fecha_creacion).getTime()+priorities[body.prioridad]*3600000).toISOString();db.prepare('UPDATE tickets SET fecha_limite=? WHERE id=?').run(deadline,id);log(id,'fecha_limite',old.fecha_limite,deadline);}
  return detail(id);
 });
}
export function assignTicket(id){
 return transaction(()=>{const t=detail(id);if(!['abierto','en progreso'].includes(t.estado))fail(409,'El ticket no admite asignación');
  const a=db.prepare("SELECT a.id FROM agentes a LEFT JOIN tickets t ON t.agente_id=a.id AND t.estado IN ('abierto','en progreso') WHERE a.activo=1 AND a.area=? GROUP BY a.id ORDER BY COUNT(t.id),a.id LIMIT 1").get(t.area);
  if(!a)fail(409,'No hay agentes activos para esta área');
  if(t.agente_id!==a.id){db.prepare('UPDATE tickets SET agente_id=? WHERE id=?').run(a.id,id);log(id,'agente_id',t.agente_id,a.id);}
  if(t.estado==='abierto'){db.prepare("UPDATE tickets SET estado='en progreso' WHERE id=?").run(id);log(id,'estado','abierto','en progreso');}return detail(id);
 });
}
const next={'abierto':['en progreso'],'en progreso':['resuelto'],'resuelto':['cerrado'],'cerrado':[]};
export function setState(id,state){return transaction(()=>{
 const t=detail(id);if(!next[t.estado].includes(state))fail(409,`Transición inválida: ${t.estado} → ${state}`);
 if(state==='resuelto'&&!db.prepare("SELECT id FROM comentarios WHERE ticket_id=? AND tipo='resolucion' LIMIT 1").get(id))fail(409,'Se requiere un comentario de resolución');
 db.prepare('UPDATE tickets SET estado=?,fecha_resolucion=CASE WHEN ?=\'resuelto\' THEN ? ELSE fecha_resolucion END WHERE id=?').run(state,state,now(),id);log(id,'estado',t.estado,state);return detail(id);
});}
export function addComment(id,body){return transaction(()=>{detail(id);if(!valid(body.autor)||!valid(body.texto)||!['general','resolucion'].includes(body.tipo||'general'))fail(400,'Comentario inválido');db.prepare('INSERT INTO comentarios(ticket_id,autor,texto,tipo,fecha) VALUES (?,?,?,?,?)').run(id,body.autor.trim(),body.texto.trim(),body.tipo||'general',now());return detail(id);});}
export function deleteTicket(id){return transaction(()=>{detail(id);db.prepare('DELETE FROM tickets WHERE id=?').run(id);});}
export function summary(){
 const status=db.prepare('SELECT estado, COUNT(*) cantidad FROM tickets GROUP BY estado').all();
 const byAgent=db.prepare("SELECT a.nombre, COUNT(t.id) abiertos FROM agentes a LEFT JOIN tickets t ON t.agente_id=a.id AND t.estado IN ('abierto','en progreso') GROUP BY a.id ORDER BY abiertos DESC").all();
 const sla=db.prepare("SELECT COUNT(*) total, SUM(CASE WHEN (estado IN ('resuelto','cerrado') AND julianday(fecha_resolucion)<=julianday(fecha_limite)) OR (estado IN ('abierto','en progreso') AND julianday(fecha_limite)>=julianday(?)) THEN 1 ELSE 0 END) cumplidos FROM tickets").get(now());
 const avg=db.prepare("SELECT ROUND(AVG((julianday(fecha_resolucion)-julianday(fecha_creacion))*24),1) horas FROM tickets WHERE fecha_resolucion IS NOT NULL").get();
 return {total:sla.total,porEstado:status,cargaAgentes:byAgent,cumplimientoSla:sla.total?Math.round(sla.cumplidos*100/sla.total):100,horasPromedioResolucion:avg.horas??0,vencidos:db.prepare("SELECT COUNT(*) cantidad FROM tickets WHERE estado IN ('abierto','en progreso') AND julianday(fecha_limite)<julianday(?)").get(now()).cantidad};
}
