// Datos de ejemplo del MODO DEMOSTRACIÓN. Todo es ficticio y vive solo en el navegador del visitante.
(() => {
  const DAY = 86400e3;
  const at = (days, hour = 23, min = 59) => { const d = new Date(Date.now() + days * DAY); d.setHours(hour, min, 0, 0); return d.toISOString(); };
  const id = (n) => `d0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const T = id(1);
  const SUBJ = id(10);
  const C = [id(21), id(22), id(23)];
  const A = { q1: id(31), q2: id(32), p1: id(33), y1: id(34), q3: id(35), p2: id(36), yF: id(37) };
  const students = [
    [id(101), 'Ana Pérez', 'ana.perez@estudiante.demo'],
    [id(102), 'Bruno Díaz', 'bruno.diaz@estudiante.demo'],
    [id(103), 'Camila Rojas', 'camila.rojas@estudiante.demo'],
    [id(104), 'David Gómez', 'david.gomez@estudiante.demo'],
    [id(105), 'Elena Martínez', 'elena.martinez@estudiante.demo'],
    [id(106), 'Felipe Castro', 'felipe.castro@estudiante.demo'],
  ];

  const grade5 = (criterios) => Math.round(criterios.reduce((s, c) => s + c.peso * c.puntaje, 0) / 10000 * 5 * 10) / 10;
  function fb(criterios, { resumen, aciertos = [], errores = [], recomendaciones = [], confianza = 0.88, alertas = [], motivo = null }) {
    const nota = grade5(criterios);
    return {
      version: 1, resumen, criterios, aciertos, errores, recomendaciones, confianza,
      requiere_revision: Boolean(motivo), motivo_revision: motivo, alertas, nota, escala: 5,
      entrega_tardia: false, modelo: 'demostración',
    };
  }
  const crit = (nombre, peso, puntaje, evidencia, comentario) => ({ nombre, peso, puntaje, evidencia, comentario });

  // Retroalimentación de ejemplo, del estilo que produce el agente real.
  const FB = {
    q1: (p) => fb([
      crit('Definición de variable', 50, p[0], '«Una variable es un espacio donde se guarda un dato»', p[0] >= 80 ? 'Definición correcta.' : 'No menciona que el nombre referencia un valor en memoria.'),
      crit('Tipos de datos', 30, p[1], '«edad = 20 · nombre = "Ana"»', p[1] >= 80 ? 'Identifica int y str correctamente.' : 'Confunde el tipo de "20" (texto) con 20 (número).'),
      crit('Claridad', 20, p[2], 'Respuesta escrita', 'Redacción breve y ordenada.'),
    ], {
      resumen: p[0] >= 80 ? 'La definición y los ejemplos de tipos son correctos; falta justificar por qué Python no exige declarar el tipo.' : 'La definición es incompleta y hay una confusión entre número y texto en uno de los ejemplos.',
      aciertos: ['Usa nombres de variables descriptivos (edad, nombre).'],
      errores: p[1] >= 80 ? [] : [{ descripcion: 'El valor "20" entre comillas es texto (str), no número', evidencia: 'edad = "20"', como_corregir: 'Escribe edad = 20 sin comillas y comprueba el tipo con type(edad).', severidad: 'media' }],
      recomendaciones: ['Repasa la diferencia entre tipado dinámico y tipado estático.'],
    }),
    q2: (p) => fb([
      crit('Lógica condicional', 60, p[0], 'if nota >= 3.0: ... else: ...', p[0] >= 80 ? 'La condición cubre todos los casos.' : 'El caso nota == 3.0 queda en la rama incorrecta.'),
      crit('Sintaxis', 25, p[1], 'Indentación del bloque else', p[1] >= 80 ? 'Sintaxis válida.' : 'La indentación del else no coincide con la del if.'),
      crit('Pruebas', 15, p[2], 'Casos de prueba incluidos', 'Incluye al menos un caso límite.'),
    ], {
      resumen: p[0] >= 80 ? 'El programa clasifica correctamente las notas y maneja el caso límite.' : 'El programa funciona para casos generales, pero falla en el límite exacto de aprobación.',
      errores: p[0] >= 80 ? [] : [{ descripcion: 'Comparación estricta en el límite', evidencia: 'if nota > 3.0', como_corregir: 'Usa >= para incluir el 3,0 como aprobado.', severidad: 'alta' }],
      recomendaciones: ['Prueba siempre los valores exactos de los límites (2,9 · 3,0 · 3,1).'],
    }),
    p1: (p) => fb([
      crit('Ejercicio 1: promedio', 35, p[0], 'Función promedio(lista)', p[0] >= 80 ? 'Correcto y maneja la lista vacía.' : 'Divide entre cero si la lista está vacía.'),
      crit('Ejercicio 2: mayor y menor', 35, p[1], 'Recorrido con for', p[1] >= 80 ? 'Correcto sin usar max()/min().' : 'Inicializa el menor en 0, lo que falla con números positivos.'),
      crit('Ejercicio 3: análisis', 30, p[2], 'Explicación de complejidad', p[2] >= 80 ? 'Explica O(n) con argumentos.' : 'Afirma la complejidad sin justificarla.'),
    ], {
      resumen: 'Dos de los tres ejercicios cumplen lo pedido; los errores se concentran en casos límite y en la justificación del análisis.',
      aciertos: ['El código está separado en funciones con nombres claros.'],
      errores: [
        ...(p[0] < 80 ? [{ descripcion: 'División entre cero con lista vacía', evidencia: 'return suma / len(lista)', como_corregir: 'Verifica if not lista antes de dividir y decide qué devolver.', severidad: 'alta' }] : []),
        ...(p[1] < 80 ? [{ descripcion: 'Valor inicial incorrecto para el menor', evidencia: 'menor = 0', como_corregir: 'Inicializa con el primer elemento de la lista.', severidad: 'media' }] : []),
      ],
      recomendaciones: ['Escribe primero los casos límite antes de programar la solución.'],
    }),
  };

  const sub = (n, act, st, puntajes, extra = {}) => {
    const f = FB[act](puntajes);
    return {
      id: id(500 + n), activity_id: A[act], student_id: st, content_text: extra.text || 'Respuesta de ejemplo del modo demostración.',
      submission_count: 1, submitted_at: at(extra.daysAgo ?? -20, 18, 30), is_late: false, eval_attempts: 1,
      status: extra.status || 'evaluada', ai_grade: f.nota, ai_feedback: f, ai_model: 'demostración', ai_confidence: f.confianza,
      evaluated_at: at((extra.daysAgo ?? -20) + 0.01, 18, 40), teacher_grade: extra.teacher_grade ?? null, teacher_comment: extra.comment ?? null,
      reviewed_at: extra.teacher_grade != null ? at(-10) : null, last_error: null,
    };
  };

  window.__DEMO_DATA__ = () => {
    const S = students.map((s) => s[0]);
    const submissions = [
      // Quiz 1 (vencido hace 20 días)
      sub(1, 'q1', S[0], [70, 60, 90], { text: 'Una variable es un espacio donde se guarda un dato.\nedad = "20"\nnombre = "Ana"' }),
      sub(2, 'q1', S[1], [90, 85, 80]), sub(3, 'q1', S[2], [60, 50, 70]), sub(4, 'q1', S[3], [95, 90, 90]), sub(5, 'q1', S[4], [80, 80, 85]),
      // Quiz 2 (vencido hace 12 días) — Felipe no entregó
      sub(11, 'q2', S[0], [90, 85, 80], { daysAgo: -12 }), sub(12, 'q2', S[1], [70, 90, 60], { daysAgo: -12 }),
      sub(13, 'q2', S[2], [55, 60, 50], { daysAgo: -12 }), sub(14, 'q2', S[3], [95, 95, 90], { daysAgo: -12 }), sub(15, 'q2', S[4], [85, 80, 70], { daysAgo: -12 }),
      // Parcial 1 (vencido hace 6 días): una en revisión docente y un ajuste del docente
      sub(21, 'p1', S[0], [60, 85, 70], { daysAgo: -6, text: 'def promedio(lista):\n    return sum(lista) / len(lista)\n\n# Ejercicio 2 y 3 en el archivo adjunto' }),
      sub(22, 'p1', S[1], [85, 80, 75], { daysAgo: -6, teacher_grade: 4.3, comment: 'Buen análisis; subo 0,2 por la prueba adicional que incluiste.' }),
      sub(23, 'p1', S[2], [40, 50, 30], { daysAgo: -6, status: 'revision' }),
      sub(24, 'p1', S[3], [95, 90, 85], { daysAgo: -6 }), sub(25, 'p1', S[4], [75, 70, 80], { daysAgo: -6 }),
      sub(26, 'p1', S[5], [70, 65, 60], { daysAgo: -6 }),
    ];
    const rev = submissions.find((x) => x.id === id(523));
    rev.ai_confidence = 0.45;
    rev.ai_feedback = { ...rev.ai_feedback, confianza: 0.45, requiere_revision: true, motivo_revision: 'Confianza baja: la entrega remite a un archivo que no contiene los ejercicios 2 y 3.', alertas: ['Entrega incompleta respecto al enunciado'] };

    return {
      profiles: [
        { id: T, email: 'docente@aula-ia.demo', full_name: 'Prof. Laura Gómez', role: 'docente', email_notifications: true },
        ...students.map(([sid, name, email]) => ({ id: sid, email, full_name: name, role: 'estudiante', email_notifications: true })),
      ],
      subjects: [{
        id: SUBJ, teacher_id: T, name: 'Programación I', code: 'PRG101', group_name: 'A', semester: '2026-2',
        description: 'Asignatura de ejemplo del modo demostración.', join_code: 'DEMO26A', enrollment_open: true,
        grade_scale: 5, pass_grade: 3, auto_publish: true, exported_at: null, created_at: at(-60),
      }],
      cortes: [30, 30, 40].map((w, i) => ({ id: C[i], subject_id: SUBJ, number: i + 1, weight: w, quiz_weight: 30, parcial_weight: 40, proyecto_weight: 30 })),
      enrollments: S.map((sid) => ({ subject_id: SUBJ, student_id: sid, enrolled_at: at(-55) })),
      activities: [
        { id: A.q1, title: 'Quiz 1 — Variables y tipos', corte: 0, component: 'quiz', opens: -27, due: -20, rubric: 'Definición de variable (50 %), tipos de datos (30 %), claridad (20 %).' },
        { id: A.q2, title: 'Quiz 2 — Condicionales', corte: 0, component: 'quiz', opens: -18, due: -12, rubric: 'Lógica condicional (60 %), sintaxis (25 %), pruebas (15 %).' },
        { id: A.p1, title: 'Parcial 1 — Fundamentos', corte: 0, component: 'parcial', opens: -9, due: -6, rubric: 'Ejercicio 1 (35 %), ejercicio 2 (35 %), análisis (30 %).' },
        { id: A.y1, title: 'Proyecto 1 — Calculadora de notas', corte: 0, component: 'proyecto', opens: -5, due: 3, rubric: 'Funcionalidad (50 %), estructura del código (30 %), documentación (20 %).', max: 2 },
        { id: A.q3, title: 'Quiz 3 — Ciclos', corte: 1, component: 'quiz', opens: -1, due: 9, rubric: 'Uso correcto de for/while (60 %), condición de parada (25 %), claridad (15 %).', max: 2 },
        { id: A.p2, title: 'Parcial 2 — Listas y funciones', corte: 1, component: 'parcial', opens: 18, due: 25 },
        { id: A.yF, title: 'Proyecto final (borrador)', corte: 2, component: 'proyecto', opens: 40, due: 70, published: false },
      ].map((a) => ({
        id: a.id, subject_id: SUBJ, corte_id: C[a.corte], component: a.component, title: a.title,
        instructions: a.component === 'proyecto'
          ? 'Desarrolla un programa en Python que lea las notas de un estudiante, calcule su promedio ponderado y diga si aprueba. Entrega el código (.py o .zip) y un README.'
          : 'Responde de forma clara y justifica cada respuesta. Puedes escribir la respuesta o adjuntar un archivo.',
        rubric: a.rubric || null, statement_path: null, statement_name: null, weight: 1,
        opens_at: at(a.opens, 7, 0), due_at: at(a.due), allow_late: false, max_submissions: a.max || 1,
        accept_text: true, accept_files: true, ai_enabled: true, published: a.published !== false,
        created_at: at(a.opens - 1), updated_at: at(a.opens - 1),
      })),
      activity_keys: Object.values(A).map((aid) => ({
        activity_id: aid, reference_solution: 'Solución de referencia de ejemplo (solo la ven el docente y el agente evaluador).',
        reference_path: null, reference_name: null, grading_notes: 'Aceptar soluciones alternativas correctas.',
      })),
      submissions, files: {},
    };
  };

  // Evaluación SIMULADA para entregas nuevas en el modo demo (la real la hace el agente con IA).
  window.__DEMO_FEEDBACK__ = (act, s) => {
    const text = `${s.content_text || ''} ${s.file_name || ''}`.trim();
    const base = Math.max(35, Math.min(92, 40 + Math.round(text.length / 6)));
    const parts = [...String(act?.rubric || '').matchAll(/([^,(.]+?)\s*\((\d+)\s*%\)/g)].map((m) => [m[1].trim(), Number(m[2])]);
    const rubric = parts.length && parts.reduce((x, p) => x + p[1], 0) === 100 ? parts : [['Corrección', 50], ['Completitud', 30], ['Claridad', 20]];
    const criterios = rubric.map(([nombre, peso], i) => crit(
      nombre.charAt(0).toUpperCase() + nombre.slice(1), peso, Math.max(0, Math.min(100, base + (i === 0 ? -5 : i * 4))),
      text ? `«${text.slice(0, 60)}${text.length > 60 ? '…' : ''}»` : 'Entrega',
      'Comentario de ejemplo: en la plataforma real, el agente explica aquí qué cumple y qué falta según este criterio.',
    ));
    const f = fb(criterios, {
      resumen: 'EVALUACIÓN SIMULADA (modo demostración). En la plataforma real, el agente de IA analiza tu respuesta frente al enunciado, la rúbrica y la solución de referencia del docente, y cita evidencias concretas de tu entrega.',
      aciertos: ['Ejemplo: se señalan los aspectos correctos, siempre con evidencia.'],
      errores: [{ descripcion: 'Ejemplo de error detectado', evidencia: 'Fragmento de la entrega donde aparece', como_corregir: 'Acción concreta para corregirlo, sin revelar la solución.', severidad: 'media' }],
      recomendaciones: ['Ejemplo de siguiente paso de estudio.'],
    });
    return { status: 'evaluada', ai_grade: f.nota, ai_feedback: f, ai_model: 'demostración', ai_confidence: f.confianza, evaluated_at: new Date().toISOString(), eval_attempts: 1 };
  };

  window.__DEMO_IDS__ = { teacher: T, student: id(101), subject: SUBJ };
})();
