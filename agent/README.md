# Agente evaluador

Proceso Node 22 que se ejecuta cada 10 minutos en GitHub Actions (`.github/workflows/agente.yml`). Cada ejecución tiene tres fases: **notificar → evaluar → notificar**. Las notificaciones son idempotentes, así que los recordatorios salen aunque la evaluación falle o se quede sin tiempo (por ejemplo, con la cuota de IA agotada).

1. **Evalúa** las entregas pendientes: reclama hasta `MAX_EVALUATIONS_PER_RUN` con `claim_submissions`, descarga los archivos (entrega, enunciado, solución de referencia), extrae el contenido (PDF e imágenes se envían tal cual a Gemini; texto, código, `.ipynb`, `.docx` y `.zip` se extraen aquí), arma el prompt con la skill `skills/evaluador-objetivo/SKILL.md`, llama a la IA con salida JSON, **calcula la nota de forma determinista** a partir de los criterios y guarda con `complete_evaluation`. Si algo falla, `fail_evaluation` (se reintenta hasta 3 veces).
   Cada entrega tiene un tiempo máximo (`MAX_ITEM_MS`, 240 s, o lo que quede de la ejecución menos 60 s): descargas y llamadas a la IA reciben una señal de aborto y no se inician reintentos que no quepan; si se agota, `fail_evaluation` con un mensaje claro.
2. **Notifica** por Gmail: retroalimentación lista → recordatorios (72 h, 24 h, 3 h) → actividades nuevas (un correo por estudiante) → resumen diario al docente (solo desde las `DIGEST_HOUR` en hora local). Cada correo se reserva antes de enviarse (`claim_notification`) y se libera si falla, así nunca se duplica.

## Variables de entorno

| Variable | Obligatoria | Por defecto | Descripción |
|---|---|---|---|
| `SUPABASE_URL` | sí | — | URL del proyecto Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | sí | — | Clave **secreta** `sb_secret_…` (o `service_role` heredada, que Supabase retira a finales de 2026) |
| `GEMINI_API_KEY` | una de las dos | — | Clave de Google AI Studio |
| `GROQ_API_KEY` | una de las dos | — | Clave de Groq (respaldo, solo texto) |
| `GEMINI_MODELS` | no | `gemini-3.8-flash,gemini-3.6-flash,gemini-flash-latest,gemini-2.5-flash,gemini-3.5-flash-lite,gemini-flash-lite-latest,gemini-2.5-flash-lite` | Orden de preferencia; se usan los que existan en tu cuenta |
| `GROQ_MODEL` | no | `openai/gpt-oss-120b` | Modelo de Groq |
| `LLM_PROVIDERS` | no | `gemini,groq` | Orden de proveedores (se ignoran los que no tienen clave) |
| `GMAIL_USER`, `GMAIL_APP_PASSWORD` | no | — | Cuenta Gmail y contraseña de aplicación; sin ellas no se envían correos |
| `MAIL_FROM_NAME` | no | `Plataforma Docente IA` | Nombre del remitente (p. ej. `Prof. Gustavo Briceño · Aula IA`) |
| `MAIL_REPLY_TO` | no | = `GMAIL_USER` | Correo que recibe las respuestas de los estudiantes |
| `APP_URL` | no | — | URL pública de la web (para los enlaces de los correos) |
| `TIMEZONE` | no | `America/Bogota` | Zona horaria de fechas y del resumen diario |
| `EMAIL_DAILY_BUDGET` | no | `450` | Tope de correos en 24 h (Gmail gratis: 500) |
| `MAX_EVALUATIONS_PER_RUN` | no | `20` | Entregas por ejecución |
| `EVAL_CONCURRENCY` | no | `2` | Evaluaciones simultáneas |
| `RUN_BUDGET_MS` | no | `480000` | Tiempo máximo por ejecución |
| `MIN_CONFIDENCE` | no | `0.6` | Por debajo, la evaluación va a revisión docente |
| `MAX_ITEM_MS` | no | `240000` | Tiempo máximo por entrega |
| `DIGEST_HOUR` | no | `7` | Hora local desde la que se envía el resumen diario al docente |
| `DRY_RUN` | no | `false` | `true`: no envía correos, solo los registra |

## Probar localmente

```bash
cd agent
node --test test/*.test.js          # 69 pruebas, sin red ni dependencias
npm install                          # solo para enviar correos de verdad (nodemailer)
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... GEMINI_API_KEY=... DRY_RUN=true node src/index.js
```

## Garantías

- La nota la calcula el agente: `escala × Σ(peso·puntaje)/10000`, redondeada a 1 decimal. El modelo solo propone criterios, puntajes y evidencia.
- Va a **revisión docente** si: confianza < `MIN_CONFIDENCE`, intento de manipulación (detectado por el modelo o por patrones), posible copia, archivo ilegible, o la actividad no tiene solución de referencia ni rúbrica.
- El prompt **no incluye nombre, correo ni IDs del estudiante**, y el archivo se presenta como `entrega.<ext>` (el nombre original podría contener datos personales).
- Filtro de tono: se eliminan elogios genéricos ("¡Excelente trabajo!", "Felicitaciones"...) y exclamaciones.
- Archivos ilegibles sin texto no consumen cuota de IA: se registran con nota 0 provisional y van a revisión.
- Si el estudiante reenvía mientras se evalúa, el resultado viejo se descarta (`stale`).
- **No revela la solución**: la skill lo prohíbe y, además, si la retroalimentación comparte una secuencia de ≥ 8 palabras (normalizadas) con la solución de referencia o las notas privadas que no esté en la entrega del estudiante, se añade la alerta "posible revelación de la solución de referencia" y va a revisión docente.
- **Rutas seguras**: solo se descargan rutas de los buckets `entregas`/`materiales` sin segmentos vacíos, `.`, `..` (ni codificados), barras invertidas ni `%2f`; se verifica que la URL final siga dentro del bucket.
- **Anti zip‑bomb**: cada entrada de un `.zip`/`.docx` se descomprime con tope `min(tamaño declarado, 5 MB)`; las que lo superan se descartan con advertencia.
- **Logs sin datos personales** (el repo es público): los correos se enmascaran (`an***@gmail.com`) en configuración, DRY_RUN y errores SMTP.
