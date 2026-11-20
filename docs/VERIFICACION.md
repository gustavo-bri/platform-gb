# Verificación (evidencia)

Ejecutado el 18 de noviembre de 2026 en un entorno limpio: Node 22, Postgres 16.15 y Chrome headless. Ninguna tarea se dio por cerrada sin su prueba.

## Resultado

| Suite | Comando | Resultado |
|---|---|---|
| Base de datos (RLS, RPC, Storage, cola, avisos, borrado) | `supabase/tests/run.sh` | **100/100** aserciones |
| Agente evaluador | `cd agent && node --test test/*.test.js` | **69/69** |
| Servidor MCP | `cd mcp && node --test test/*.test.mjs` | **18/18** |
| Web: notas, Excel/CSV (validado con openpyxl), cliente Supabase | `cd web && node --test test/*.test.mjs` | **14/14** |
| Web de punta a punta (docente + 2 estudiantes, 360 px, tema oscuro, teclado) | `cd web && node test/e2e/run.mjs` | **16/16** pasos, 0 errores de consola |
| Auditoría de interfaz (skill senior-frontend) | `auditoria_ui.py web/` | 0 hallazgos, salvo 1 excepción justificada (abajo) |
| Workflows | PyYAML | `agente.yml` y `web.yml` válidos |
| Coherencia de contratos | script de cruce RPC ↔ esquema | 20 llamadas RPC, 0 discrepancias |

**Excepción justificada de la auditoría UI**: `web/js/ui.js:14` usa `innerHTML`. Es el único punto de inserción de HTML y solo recibe plantillas `html```, que escapan automáticamente cada valor interpolado. Ningún otro archivo usa `innerHTML`, y la revisión independiente confirmó que no hay XSS.

## Flujo E2E verificado

1. Docente sin asignaturas ve el estado vacío.
2. Crea una asignatura: nacen 3 cortes y un código de inscripción.
3. Crea un quiz con solución de referencia privada.
4. Crea un parcial: aparece el aviso de precisión y no se permite un segundo parcial en el corte.
5. Una estudiante se inscribe con el enlace.
6. Una entrega vacía se rechaza y la entrega de texto se envía.
7. Se simula al agente: la estudiante ve nota 3,8 con criterios, errores y recomendaciones, sin ver la solución de referencia.
8. La docente ajusta la nota a 4,2 con comentario.
9. Un segundo estudiante se inscribe escribiendo el código.
10. Se registra una nota manual para quien no entregó.
11. Se descargan Excel y CSV del corte y el historial completo.
12. Unas ponderaciones que no suman 100 % se rechazan y las válidas se guardan.
13. El borrado exige escribir el nombre y haber descargado el historial antes.
14. No hay desbordamiento horizontal a 360 px y el tema oscuro se aplica.
15. El modal funciona con teclado (Enter, foco inicial, Esc).
16. La consola no muestra errores ni advertencias.

## Fallos encontrados durante la construcción (depuración sistemática)

| Síntoma | Hipótesis comprobada | Corrección |
|---|---|---|
| La página se descargaba en vez de abrirse en la prueba E2E | El servidor de pruebas calculaba el tipo MIME sobre `/` y no sobre `index.html` | Calcular el MIME sobre el archivo resuelto |
| Ambigüedad de botones en el modal | El `<footer>` del modal se exponía como landmark `contentinfo` (defecto real de accesibilidad) | Encabezado y pie del modal como `<div>` |
| Desborde de 22 px a 360 px en la vista de actividad | La columna de la cuadrícula tomaba el ancho mínimo del selector de archivo | `grid-template-columns: minmax(0,1fr)` y `min-width: 0` en los hijos |
| Ruta "no encontrada" en la prueba móvil | Los datos de demostración no usaban UUID y el enrutador solo acepta UUID (correcto) | Datos de prueba con UUID |
| Aserción de la cola fallaba | Dos subconsultas del mismo `SELECT` comparten instantánea y no ven la actualización de la función | Separar en dos sentencias (el esquema era correcto) |
| Las claves nuevas de Supabase (`sb_publishable_…`, `sb_secret_…`) no son JWT | Supabase rechaza esas claves en `Authorization: Bearer` y retira las heredadas a finales de 2026 | Web, agente y MCP envían la clave solo en `apikey`; `Authorization` solo lleva JWT. Con pruebas |

## Revisión independiente

Un agente que no participó en la construcción auditó todo el proyecto y reportó 19 defectos. Todos están corregidos y tienen prueba.

| # | Severidad | Defecto | Corrección |
|---|---|---|---|
| 1 | Crítica | Recorrido de rutas en `file_path` (`../../rest/v1/activity_keys`) que hacía al agente pedir URLs arbitrarias con la clave secreta | La RPC exige el patrón exacto y que el objeto exista en Storage. El agente rechaza `.`, `..`, `%2e`, `%2f`, `\` y control, y verifica el prefijo de la URL final. Con pruebas en SQL y en el agente |
| 2 | Alta | Reclamo infinito de entregas "colgadas" y timeout que impedía notificar | Tope de 3 intentos (luego pasa a `error`), límite de tiempo por entrega con `AbortSignal` y orden notificar → evaluar → notificar |
| 3 | Alta | La retroalimentación podía revelar la solución de referencia | Regla de confidencialidad en la skill y filtro determinista de n-gramas (≥ 8 palabras) que fuerza la revisión docente |
| 4 | Media | Bomba de descompresión en `.zip`/`.docx` | Tope de 5 MB por entrada descomprimida |
| 5 | Media | El borrado eliminaba archivos antes de que el servidor validara | Borrado en dos fases: `prepare_subject_deletion` valida y bloquea, luego se borran los archivos y después las filas. Se puede reintentar |
| 6 | Media | Subida de archivos en carpetas de otras asignaturas y sin límite | La política verifica que la asignatura y la actividad coincidan y permite máx. 15 archivos por carpeta |
| 7 | Media | Cierre de sesión inesperado con varias pestañas | Sesión compartida entre pestañas (evento `storage`) y adopción del token ya renovado |
| 8 | Media | Cambiar la escala reinterpretaba notas existentes | Un disparador impide cambiar la escala si ya hay notas |
| 9 | Media | "Reevaluar" dejaba oculta la nueva nota de la IA | El reencolado limpia la nota y el comentario del docente. El aviso por correo se identifica por evaluación |
| 10 | Media | El docente podía calificar una versión que no vio | `p_count` / `envio` comparan la versión revisada con la actual |
| 11 | Baja | Una nota manual consumía el único envío | Las notas manuales se crean con `submission_count = 0` |
| 12 | Baja | Dos correos seguidos ("nueva" + recordatorio) | El recordatorio espera 12 h tras "nueva", salvo el de 3 h |
| 13 | Baja | Correos visibles en los registros públicos de Actions | Los correos se enmascaran (`an***@gmail.com`) |
| 14 | Baja | Rol docente sin correo confirmado | Exige `email_confirmed_at`, se promueve al confirmar y el README indica desactivar el proveedor Email |
| 15 | Baja | Prompt injection hacia el cliente MCP del docente | Texto del estudiante delimitado con nonce y aviso en las instrucciones |
| 16 | Baja | `exported_at` y `join_code` se podían fijar al crear la asignatura | Un disparador los fija en el servidor |
| 17 | Baja | El contrato de cálculo del quiz no coincidía con la implementación | `ARQUITECTURA.md` §7 alineado: nota acumulada, % evaluado y promedio sobre lo evaluado |
| 18 | Baja | El estudiante veía alertas internas | La vista omite `alertas`, `motivo_revision`, `confianza`, `requiere_revision` y `modelo` |
| 19 | Baja | El resumen diario llegaba a medianoche | Se envía a partir de `DIGEST_HOUR` (7:00 por defecto) |

## Lo que no se pudo verificar aquí, y cómo verificarlo al desplegar

Este entorno no tiene acceso a internet, por lo que no se probaron contra los servicios reales:

- **Login con Google en Supabase.** El cliente implementa el flujo implícito (`#access_token`) con pruebas unitarias. Verifícalo con el paso 6 del README.
- **Llamadas reales a Gemini y Groq.** Probadas con respuestas simuladas, incluidos los errores 429, 404, 400 de esquema y JSON inválido. Verifícalas con `DRY_RUN=true` y "Run workflow".
- **Envío real por Gmail SMTP.** Lo hace nodemailer, que el workflow instala. Verifícalo con una entrega de prueba.
- **Nombres exactos de los modelos gratuitos de Gemini.** Cambian con frecuencia. El agente consulta `models.list` y usa los que existan de la cadena `GEMINI_MODELS`.
