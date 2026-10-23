import { Router } from 'express';
import { getOne,listSimple,writeSimple,deleteSimple,detail,listTickets,createTicket,updateTicket,assignTicket,setState,addComment,deleteTicket,summary,fail } from '../services/core.js';
export const router=Router();
const wrap=fn=>(req,res,next)=>{try{fn(req,res);}catch(e){next(e);}};
const id=req=>{const n=Number(req.params.id);if(!Number.isSafeInteger(n)||n<=0)fail(400,'ID inválido');return n;};
router.get('/resumen',wrap((req,res)=>res.json(summary())));
for(const table of ['clientes','agentes']){
 router.get(`/${table}`,wrap((req,res)=>res.json(listSimple(table))));
 router.get(`/${table}/:id`,wrap((req,res)=>{const record=getOne(table,id(req));if(!record)fail(404,'Registro no encontrado');res.json(record);}));
 router.post(`/${table}`,wrap((req,res)=>res.status(201).json(writeSimple(table,null,req.body))));
 router.put(`/${table}/:id`,wrap((req,res)=>res.json(writeSimple(table,id(req),req.body))));
 router.delete(`/${table}/:id`,wrap((req,res)=>{deleteSimple(table,id(req));res.status(200).json({ok:true});}));
}
router.get('/tickets',wrap((req,res)=>res.json(listTickets())));
router.get('/tickets/:id',wrap((req,res)=>res.json(detail(id(req)))));
router.post('/tickets',wrap((req,res)=>res.status(201).json(createTicket(req.body))));
router.put('/tickets/:id',wrap((req,res)=>res.json(updateTicket(id(req),req.body))));
router.delete('/tickets/:id',wrap((req,res)=>{deleteTicket(id(req));res.json({ok:true});}));
router.post('/tickets/:id/asignar',wrap((req,res)=>res.json(assignTicket(id(req)))));
router.patch('/tickets/:id/estado',wrap((req,res)=>res.json(setState(id(req),req.body.estado))));
router.post('/tickets/:id/comentarios',wrap((req,res)=>res.status(201).json(addComment(id(req),req.body))));
router.post('/ia/analizar',async(req,res,next)=>{try{
 const ticketId=Number(req.body?.ticketId);if(!Number.isSafeInteger(ticketId)||ticketId<=0)fail(400,'ID de ticket inválido');const ticket=detail(ticketId);
 const url=process.env.N8N_WEBHOOK_URL;
 if(!url)return res.status(503).json({ok:false,data:null,error:'Configure N8N_WEBHOOK_URL en .env'});
 const webhook=new URL(url);if(!['http:','https:'].includes(webhook.protocol))fail(500,'N8N_WEBHOOK_URL debe usar HTTP o HTTPS');
 if(webhook.protocol!=='https:'&&!['localhost','127.0.0.1','::1'].includes(webhook.hostname))fail(500,'N8N_WEBHOOK_URL debe usar HTTPS fuera del equipo local');
 const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),20000);
 const analysisTicket={id:ticket.id,titulo:ticket.titulo,descripcion:ticket.descripcion,area:ticket.area,prioridad:ticket.prioridad};
 try {const result=await fetch(webhook,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ticket:analysisTicket}),signal:controller.signal,redirect:'error'});const value=await result.json();if(!result.ok||value.ok!==true)throw Error(value.error||'Respuesta del agente inválida');res.json({ok:true,data:value.data,error:null});}
 finally{clearTimeout(timeout);}
}catch(e){next(e);}});
