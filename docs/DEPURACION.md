# Depuración sistemática

Regla: **no cambies nada hasta tener una hipótesis comprobada.** El ciclo es siempre el mismo:

1. **Síntoma**: qué se esperaba y qué pasó, con el mensaje exacto.
2. **Hipótesis**: una sola causa probable.
3. **Comprobación**: una observación que confirme o descarte la hipótesis (registro, consulta SQL, red del navegador).
4. **Corrección** de la causa, no del síntoma, y **verificación**: repite el caso que fallaba y ejecuta las pruebas.

Si la comprobación descarta la hipótesis, vuelve al paso 2 con la siguiente. No acumules cambios especulativos.

## Dónde mirar

| Fuente | Cómo |
|---|---|
| Registro del agente | GitHub → Actions → agente → última ejecución → paso "Ejecutar agente" |
| Estado de entregas | Supabase → SQL Editor: `select status, eval_attempts, last_error, ai_model from submissions order by submitted_at desc limit 20;` |
| Correos enviados | `select kind, sent_at from notification_log order by sent_at desc limit 50;` |
| Errores en la web | Navegador → F12 → Consola y pestaña Red (filtra por `supabase.co`) |
| Login | Supabase → Authentication → Logs |

## Casos frecuentes

### "Falta configurar la plataforma" al abrir la web
- **Hipótesis**: `web/config.js` aún tiene los valores de ejemplo.
- **Comprobación**: abre `https://…/config.js` en el navegador.
- **Corrección**: pon la Project URL y la clave publicable, y haz push. El flujo `web` vuelve a publicar.

### Google devuelve "redirect_uri_mismatch" o vuelve a la página de login
- **H1**: en Google Cloud falta `https://TU-PROYECTO.supabase.co/auth/v1/callback`. Compruébalo comparando, carácter por carácter, la URL del error con la de la consola.
- **H2**: la URL de la web no está en Supabase → Authentication → URL Configuration → Redirect URLs. Compruébalo en Auth Logs (aparece "redirect url not allowed"). Recuerda que la URL debe terminar en `/`.

### Entro como estudiante pero soy docente
- **Hipótesis**: el correo no estaba en `teacher_allowlist` cuando te registraste, o está escrito distinto.
- **Comprobación**: `select email, role from profiles where email ilike '%tu.correo%';`
- **Corrección**: `insert into teacher_allowlist(email) values ('tu.correo@gmail.com');` (en minúsculas). El disparador promueve el perfil. Luego recarga la web.

### Las entregas se quedan "Evaluando…"
1. ¿Corre el agente? En Actions debe haber ejecuciones cada 10–20 minutos.
   - Si no hay ninguna: el cron se desactiva tras 60 días sin actividad. Ve a Actions → agente → *Enable workflow*.
   - Si los cron llegan tarde (en horas pico GitHub los retrasa): es normal. Si molesta, usa un disparador externo gratuito (cron-job.org → API `workflow_dispatch`).
2. ¿El registro muestra un error de configuración? Corrige el secreto que nombra el mensaje.
3. Consulta `last_error` en `submissions`:
   - `429` / `RESOURCE_EXHAUSTED`: se agotó la cuota gratuita de Gemini. El agente reintenta y cambia de modelo. Añade `GROQ_API_KEY` como respaldo o reduce `MAX_EVALUATIONS_PER_RUN`.
   - `404` en todos los modelos: los nombres de modelo cambiaron. Ajusta la variable `GEMINI_MODELS` con los que liste AI Studio.
   - `permission denied for function claim_submissions`: estás usando la clave publicable en lugar de la secreta en `SUPABASE_SERVICE_ROLE_KEY`.
4. Después de 3 fallos la entrega queda en "Error de evaluación". El docente puede pulsar **Reevaluar con IA** o calificar a mano.

### La nota de la IA parece injusta
- **Hipótesis A**: falta solución de referencia o rúbrica. Compruébalo en la tarjeta "Solución de referencia" de la actividad. Sin ellas, la evaluación va siempre a tu revisión.
- **Hipótesis B**: la rúbrica es ambigua. Revisa los criterios y su evidencia en la retroalimentación. Si el modelo interpretó mal un criterio, reescríbelo con pesos explícitos, añade "Indicaciones privadas para el agente" y pulsa **Reevaluar con IA**.
- La nota se calcula de forma determinista a partir de los criterios: `escala × Σ(peso × puntaje) / 10000`. Para cambiar el resultado se ajustan los criterios, no el número final.

### No llegan los correos
1. ¿El registro del agente dice "correos omitidos: faltan credenciales"? Revisa `GMAIL_USER` y `GMAIL_APP_PASSWORD`.
2. `535 Username and Password not accepted`: usa una **contraseña de aplicación**, no la contraseña normal (requiere verificación en 2 pasos).
3. `550 5.4.5 Daily sending quota exceeded`: se superaron los 500 destinatarios del día. Baja `EMAIL_DAILY_BUDGET`.
4. Busca en *Spam* del destinatario y marca "No es spam" una vez.
5. ¿El estudiante desactivó "Avisos por correo" en su menú? Compruébalo: `select email_notifications from profiles where email = '…';`

### "No tienes permiso para realizar esta acción"
- **Hipótesis**: la política RLS lo impide como se diseñó. Por ejemplo, un estudiante que intenta ver una actividad no publicada o un docente con una asignatura de otro.
- **Comprobación**: reproduce el caso en `supabase/tests/10_tests.sql` con `set role authenticated` y `t.as_user('<uuid>')`, y ejecuta `supabase/tests/run.sh`.

### No me deja borrar la asignatura
- Mensaje "Hubo cambios en las notas después de tu última descarga": descarga de nuevo el **historial completo** (Calificaciones o Ajustes) y vuelve a intentar. Es una protección intencional.

### El proyecto de Supabase se pausó
- El plan gratuito pausa tras 7 días sin actividad. El agente consulta la base cada 10 min y lo evita, pero solo si su cron está activo. Reactiva el proyecto desde el panel de Supabase y luego el workflow.

## Antes de dar por cerrada una corrección
- [ ] El caso que fallaba ahora funciona (con evidencia: registro, captura o consulta).
- [ ] `supabase/tests/run.sh`, `node --test` en `agent/`, `mcp/` y `web/`, y `node test/e2e/run.mjs` pasan.
- [ ] Si cambió el contrato (RPC, columnas, `ai_feedback`), actualizaste `docs/ARQUITECTURA.md` y las tres piezas.
