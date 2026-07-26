---
title: Club operativo — alcance por división, agenda, rival, posiciones y portal del jugador
type: feature
status: proposed
spec: club-operativo
created: 2026-07-26
---

# Club operativo — alcance por división, agenda, rival, posiciones y portal del jugador

## Descripción del Cambio

Construir la semana del club ([[gestion-semanal]]) cambió el mapa: hay entrenamientos,
asistencia, disponibilidad y convocatoria, pero no hay dónde verlo junto, y el modelo de
permisos que antes molestaba ahora es un agujero.

Este cambio cierra eso: **permisos por división**, una **pantalla Hoy** y un **calendario**
que reúnen lo construido, **rival como entidad** para poder comparar entre fechas,
**tabla de posiciones**, **portal del jugador** y el **aviso de convocatoria**.

Incluye además la deuda técnica que dejó el ciclo anterior, que en esta app no es cosmética:
el bundle pesa 3.2 MB sin code splitting, en un producto cuyo argumento es funcionar con
mala señal en una cancha.

---

## Motivación

### El agujero de permisos

`_get_division_or_404` en `trainings.py` valida **el club, no la división**. Con
`gestion-semanal` en producción eso significa:

- Un `match_director` crea y borra entrenamientos de cualquier división del club.
- Un `analyst` toma y **pisa** la asistencia de cualquier división.

Antes de tener entrenamientos era incómodo. Ahora que el entrenador de M17 entra todas
las semanas, es el próximo incidente.

### Lo construido no tiene dónde verse

No hay landing: todos caen en `/tournaments`. Asistencia, lesiones, aptos por vencer,
jugadores en riesgo y rojas sin cargar viven cada uno en su pantalla. Nadie tiene la
foto del día.

---

## Fases de Implementación

### Fase A: Alcance por división
- [ ] Migración: tabla `user_divisions` (`user_id`, `division_id`)
- [ ] **Sin filas = acceso a todas las divisiones del club.** Es lo que hace que la
      migración no rompa a ningún usuario existente y que un club chico no tenga que
      configurar nada
- [ ] `club_admin` y `superadmin` ignoran el alcance: siempre ven todo
- [ ] `assert_division_access(division, user, db)` en `core/deps.py`
- [ ] Aplicarlo en `trainings.py`, `injuries.py`, `season.py`, `players.py`,
      `performance.py` y en `lineup.py` (vía sesión → torneo → división)
- [ ] `GET/PUT /clubs/{id}/users/{user_id}/divisions` para administrarlo
- [ ] UI en Config: asignar divisiones al crear/editar usuario
- [ ] Tests: un director con alcance M17 no toca Primera; sin alcance sigue viendo todo

### Fase B: Deuda técnica
- [ ] Code splitting por ruta (`React.lazy` + `Suspense`) y `manualChunks` para ECharts
      y `xlsx`, que son el grueso del bundle
- [ ] Objetivo: **el chunk inicial por debajo de 600 kB**
- [ ] `GET /clubs/{id}/attendance/at-risk` — hoy `Squad.tsx` hace un request por división
      cuando el filtro está en "Todos"
- [ ] Verificar que el tablero de partido siga entrando sin red tras el split

### Fase C: Pantalla Hoy
- [ ] `GET /clubs/{id}/today` — un solo request que arma la foto del día
- [ ] Ruta `/hoy` como landing por defecto de todos los roles de club
- [ ] Contenido: próximo partido, entrenamientos de hoy con acceso directo a la planilla,
      lesionados, aptos por vencer o vencidos, jugadores en riesgo, rojas sin cargar
- [ ] Respeta el alcance por división de la Fase A
- [ ] Estado vacío que no parezca un error: un club sin nada cargado hoy es lo normal

### Fase D: Calendario unificado
- [ ] `GET /divisions/{id}/calendar?from=&to=` — partidos y entrenamientos en una serie
- [ ] Vista de mes con marcas por tipo, y lista del día seleccionado
- [ ] Desde el calendario se entra a la planilla de asistencia o al partido

### Fase E: Rival como entidad
- [ ] Migración: tabla `opponents` (`club_id`, `name`) + `sessions.opponent_id` nullable
- [ ] **Backfill**: los `away_team` existentes se normalizan a `opponents` por nombre
- [ ] `sessions.home_team` / `away_team` se conservan: son el registro histórico de cómo
      se llamó ese partido y hay stats que dependen de ellos
- [ ] `GET /clubs/{id}/opponents` y `GET /opponents/{id}/history` — historial contra ese
      rival: partidos, resultados, tries a favor y en contra
- [ ] Selector de rival con autocompletado al crear un partido

### Fase F: Tabla de posiciones
- [ ] `GET /tournaments/{id}/standings` — calculada desde los eventos, sin modelo nuevo
- [ ] Puntaje configurable por torneo (ganado/empate/perdido, bonus ofensivo y defensivo),
      con el default de URBA (4/2/0 + bonus)
- [ ] Sólo se cuentan partidos `finished`: uno en curso no tiene resultado
- [ ] Vista en la pantalla del torneo

### Fase G: Portal del jugador
- [ ] Rol `player` y `players.user_id` nullable
- [ ] `POST /players/{id}/invite` — genera el acceso del jugador
- [ ] Un `player` sólo ve **su propia ficha**: asistencia, minutos, tests, físico, lesiones
- [ ] Nav reducido y sin acceso a nada del club
- [ ] Tests: un jugador no puede leer la ficha de otro ni ningún endpoint de club

### Fase H: Aviso de convocatoria
- [ ] `GET /sessions/{id}/squad/message` — texto listo para pegar, con fecha, hora, rival
      y lugar
- [ ] Marcar convocatoria como **notificada**, con fecha
- [ ] Confirmación del jugador desde el portal (`confirmado` / `baja`), que ya existe como
      estado en `match_squad` y hoy nadie escribe

### Fase J: "Físico" pasa a ser "Mediciones", con dos áreas
Hoy `/performance` mezcla dos trabajos que hacen personas distintas. Se parte en dos
solapas dentro de una sección renombrada **Mediciones**:

- [ ] Renombrar la sección y la ruta: `Físico` → **Mediciones** (`/mediciones`, con
      redirect desde `/performance` para no romper links guardados)
- [ ] **Solapa Físico**, con los tests agrupados por categoría:
      - **Potencia**: Test de Salto
      - **Resistencia**: Bronco
      - **Fuerza**: Press Banca 3RM, Sentadilla 3RM
- [ ] **Solapa Nutrición**: mediciones antropométricas, evolución de peso, evolución de
      % de grasa y pliegues
- [ ] Agregar los tests que falten al catálogo (`Bronco`, `Press Banca 3RM`,
      `Sentadilla 3RM`) con su unidad y su criterio de orden — en fuerza **mayor es
      mejor**, en Bronco **menor tiempo es mejor**
- [ ] Los tests existentes que no entren en las tres categorías se conservan bajo
      "Otros": renombrar la sección no puede perder datos ya cargados
- [ ] Gráfico de evolución por test y por jugador en ambas solapas

### Fase K: Tema claro
El producto pasa de oscuro a claro, con identidad propia.

- [ ] Paleta: fondo **blanco**, primario **#211E67**, acento **#FF1B20**
- [ ] Definir la paleta como tokens en `tailwind.config.ts` y usarla por nombre, no por
      hexadecimal suelto — un cambio de marca no puede exigir tocar 20 archivos otra vez
- [ ] Contraste AA en texto secundario: gris claro sobre blanco es el error típico de
      un pasaje a tema claro
- [ ] Revisar el tablero de cancha **al sol**: es la pantalla que se usa afuera y la que
      más sufre un tema claro mal contrastado
- [ ] Rojo reservado para destructivo y alertas; no usarlo como color de acento general

### Fase I: Documentación
- [ ] `openspec/specs/club-operativo.md`
- [ ] Actualizar `data-model.md`, `auth-and-users.md` y `README.md`

---

## Fuera de Alcance

| Faltante | Por qué no ahora |
|----------|------------------|
| **Periodización de carga** (minutos + tests + asistencia) | Necesita al menos una temporada de datos cargados para que la recomendación no sea ruido. Sin eso es una pantalla que inventa |
| Cuotas y pagos | Otro dominio entero; no se toca hasta que el club lo pida |
| Notificaciones push / PWA instalable | La Fase H entrega el texto para pegar, que es el 90% del valor a 5% del costo. Push se evalúa después |
| Datos de menores (tutor, consentimiento) | Consideración legal que conviene resolver con el club, no por default técnico |

---

## Impacto en Código Existente

| Área | Impacto |
|------|---------|
| `core/deps.py` | **Nuevo**: `assert_division_access`, usado por casi todos los routers |
| `trainings.py`, `injuries.py`, `season.py`, `players.py`, `performance.py`, `lineup.py` | Chequeo de alcance agregado |
| `App.tsx` | Rutas a `React.lazy`; landing pasa a `/hoy` |
| `vite.config.ts` | `manualChunks` |
| `Squad.tsx` | Un request en lugar de N |
| `sessions` | Columna `opponent_id` nullable; `home_team`/`away_team` intactos |
| Usuarios existentes | **Ninguno**: sin filas en `user_divisions` el acceso es el de hoy |
| Tablero de partido | **No se toca** |

**Regla dura**: si al terminar este cambio un usuario existente pierde acceso a algo que
hoy ve, la Fase A está mal implementada. El alcance se opta, no se impone.

---

## Decisiones Técnicas

| Decisión | Elección | Razón |
|----------|----------|-------|
| Alcance vacío | = todas las divisiones | Migración sin rotura y sin configuración obligatoria para clubes chicos |
| Rival | Entidad nueva **junto a** los strings | `home_team`/`away_team` son el registro de cómo se llamó ese partido; borrarlos rompe stats |
| Posiciones | Calculadas | Mismo criterio que minutos: persistirlas sería una segunda fuente de verdad |
| Portal del jugador | Rol propio + FK en `players` | Un jugador no es un usuario de club con menos permisos: es otro sujeto |
| Notificación | Texto para copiar | Push exige service worker, permisos y backend de envío; el grupo de WhatsApp ya existe |
| Code splitting | Por ruta + vendor chunks | El tablero de cancha no tiene por qué bajar ECharts ni `xlsx` |

---

## Criterios de Aceptación

- [ ] Un `match_director` con alcance en M17 recibe `403` en los endpoints de Primera
- [ ] Un usuario **sin** alcance asignado sigue viendo exactamente lo que veía antes
- [ ] El chunk inicial baja de 600 kB y el tablero de partido carga sin red
- [ ] `/hoy` responde con un solo request y muestra la foto del día
- [ ] El calendario muestra partidos y entrenamientos juntos, por división
- [ ] El historial contra un rival cruza partidos de distintas fechas
- [ ] La tabla de posiciones ignora partidos no terminados
- [ ] Un `player` logueado ve su ficha y recibe `403` en cualquier endpoint de club
- [ ] La suite completa queda verde y las migraciones corren en ambas direcciones

---

## Riesgos

| Riesgo | Mitigación |
|--------|-----------|
| El alcance por división deja gente afuera sin querer | Vacío = todo; se opta explícitamente. Test dedicado a ese caso |
| El code splitting rompe la carga del tablero en cancha | `Suspense` con fallback y verificación de que el chunk del tablero no arrastre ECharts |
| El backfill de rivales une clubes homónimos de distinta unión | Se normaliza por nombre exacto dentro del club; los duplicados se unifican a mano después |
| El portal del jugador expone datos de otros | Test explícito de acceso cruzado antes de habilitarlo |
| Scope creep hacia gestión administrativa | *Fuera de Alcance* es una regla, no una preferencia |

---

## Relacionado

- [[gestion-semanal]] — la capa que este cambio hace operable
- [[auth-and-users]] — roles actuales, que la Fase A extiende
- [[data-model]] — schema
- [[statistics-screens]] — stats por partido, que la Fase F agrega al torneo
