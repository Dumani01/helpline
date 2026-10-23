import { app } from './app.js';
import './db.js';
// La configuración de autenticación se carga al iniciar el proceso; reinicio tras cambios en .env.
const port=Number(process.env.PORT||3001);
const host=process.env.HOST||'127.0.0.1';
app.listen(port,host,()=>console.log(`API de Soporte SLA: http://${host}:${port}`));
