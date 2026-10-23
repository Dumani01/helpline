# Bitácora de IA — Laboratorio 2

Este documento registra instrucciones representativas utilizadas durante el desarrollo asistido. Las respuestas se incorporaron únicamente después de revisar el código; las verificaciones finales se documentan por separado.

| Fase | Prompt relevante | Propuesta obtenida | Revisión o corrección |
|---|---|---|---|
| Día 1 — modelo | «Diseña tablas SQLite para una mesa de ayuda con agentes, clientes, tickets, comentarios e historial; incluye PK, FK y CHECK». | Esquema relacional de cinco tablas con restricciones. | Se añadió integridad referencial, índices y datos reproducibles con `INSERT OR IGNORE`. |
| Día 1 — API | «Diseña una API REST Express por capas para dos recursos con GET/POST/PUT/DELETE, 400/404/409». | Servicios, controlador y manejador global de errores. | Se separaron rutas y servicios, validando IDs y evitando concatenar valores en SQL. |
| Día 1 — reglas | «Implementa transiciones de tickets, SLA 4/24/72 h, asignación por menor carga y registro auditable dentro de transacciones». | Reglas encapsuladas en servicios. | Se exige comentario de resolución y se conserva fecha de creación al recalcular SLA. |
| Día 2 — interfaz | «Crea React Router con panel, listado filtrable, detalle con historial y formulario controlado; agrega useFetch». | Componentes de navegación y páginas. | Se centralizaron peticiones en `services/api.js` y se manejan estados de error/carga. |
| Día 2 — agente | «Diseña n8n Webhook → AI Agent → validación de JSON → Respond to Webhook para clasificación de soporte». | Workflow JSON exportable con respuesta `{ok,data,error}`. | Se añadió validación del contrato; el borrador IA requiere aprobación del técnico. |
| Pruebas | «Escribe pruebas de API para 201, 400, 404, 409, asignación, resolución e historial». | Pruebas con `node:test`. | Se revisaron los flujos de transición y la integridad en las operaciones. |

**Nota de honestidad:** esta bitácora describe el proceso de elaboración asistido en esta entrega. No afirma que un modelo externo, n8n o una credencial de IA hayan ejecutado el workflow en vivo. El estudiante debe personalizarla con capturas y resultados de sus propias pruebas antes de presentarla.
