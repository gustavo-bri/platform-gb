# Plan de implementación (tareas atómicas con verificación)

Cada tarea tiene un resultado observable y una verificación con evidencia. Ninguna se da por cerrada sin su verificación (ver `VERIFICACION.md`).

| # | Tarea | Archivos | Verificación |
|---|---|---|---|
| 1 | Contrato de datos, estados y RPC | `docs/ARQUITECTURA.md` | Revisión cruzada: la web y el agente usan solo lo definido aquí |
| 2 | Esquema, RLS, RPC y Storage | `supabase/schema.sql` | `supabase/tests/run.sh` en Postgres real: 100 aserciones (permisos, cola, idempotencia, borrado, recorrido de rutas) |
| 3 | Skill de evaluación objetiva | `agent/skills/evaluador-objetivo/SKILL.md` | Pruebas del prompt: delimitación de la entrega, sin datos personales, reglas anti‑adulación presentes |
| 4 | Extracción de archivos (texto, código, docx, zip, pdf, imagen) | `agent/src/files.js` | `node --test`: fixtures reales generados con Python (zip, docx) |
| 5 | Clientes LLM con descubrimiento de modelos, reintentos y respaldo | `agent/src/llm/*` | `node --test` con `fetch` simulado: 429 → reintento, 404 → siguiente modelo, JSON inválido → reintento |
| 6 | Normalización de la evaluación y nota determinista | `agent/src/evaluation.js` | `node --test`: pesos que no suman 100, puntajes fuera de rango, alertas → revisión |
| 7 | Orquestador de evaluación (concurrencia, stale, fallos) | `agent/src/evaluator.js` | `node --test` con Supabase simulado |
| 8 | Notificaciones por correo (idempotentes, con presupuesto) | `agent/src/notifier.js`, `mailer.js`, `templates.js` | `node --test`: reserva → envío → liberación si falla; presupuesto agotado → se detiene |
| 9 | Programación en GitHub Actions + keepalive | `.github/workflows/agente.yml` | Validación YAML; pasos documentados |
| 10 | Cliente Supabase propio (auth Google, REST, RPC, Storage) | `web/js/sb.js` | Pruebas de construcción de URLs y manejo de sesión |
| 11 | Cálculo de notas | `web/js/grading.js` | `node --test` con casos límite (quizzes ponderados, vencidas, revisión) |
| 12 | Exportación Excel/CSV | `web/js/xlsx.js`, `reports.js` | Archivo generado abierto con openpyxl; CSV con BOM UTF‑8 y `;` para Excel en español |
| 13 | Vistas docente/estudiante responsive | `web/js/views/*`, `web/assets/styles.css` | Playwright con backend simulado: flujo completo + capturas móvil/escritorio, sin errores de consola |
| 14 | Servidor MCP para el docente | `mcp/server.mjs` | Sesión JSON‑RPC por stdio: `initialize`, `tools/list`, `tools/call` |
| 15 | Revisión independiente | — | Un agente que no escribió el código audita seguridad y coherencia; se corrigen los hallazgos |
| 16 | Guía de despliegue y depuración | `README.md`, `docs/DEPURACION.md` | Pasos verificables uno a uno |

## Patrones aplicados

- **Writing Plans**: este documento; tareas pequeñas, cada una con su prueba.
- **Subagent‑Driven Development / Dispatching Parallel Agents**: con el contrato fijado, el agente evaluador y el servidor MCP se construyeron en paralelo por subagentes mientras se construía la web; dentro del producto, el agente evalúa entregas con concurrencia limitada.
- **Verification Before Completion**: `VERIFICACION.md` contiene la evidencia (salidas reales de las pruebas).
- **Systematic Debugging**: `DEPURACION.md` define el ciclo síntoma → hipótesis → comprobación → corrección para cada falla típica.
- **Skill Creator**: la política de evaluación vive como skill (`agent/skills/evaluador-objetivo/SKILL.md`) y se carga como instrucción de sistema del agente; también se puede usar en Claude Code (`.claude/skills/`).
- **MCP Builder**: `mcp/` expone la plataforma como herramientas MCP para que el docente consulte y califique desde un cliente MCP.
