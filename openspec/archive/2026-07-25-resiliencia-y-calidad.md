---
title: Resiliencia en cancha, corrección de % graso y base de calidad
status: completed
created: 2026-07-25
completed: 2026-07-25
---

# Resiliencia en cancha, corrección de % graso y base de calidad

Surge de un relevamiento completo del código. Agrupa los hallazgos en tres tandas
ordenadas por impacto sobre el uso real de la app.

## Motivación

La app estaba funcionalmente completa (tablero, stats, plantel, físico, importación)
pero tenía tres agujeros que la volvían frágil justo donde se usa: la cancha.

---

## Tanda 1 — Que no se pierdan datos

### 1. Ruta `/dashboard` inexistente
`Session.tsx` navegaba a `/dashboard`, que no existe en `App.tsx`. El botón "← Volver"
del tablero dejaba pantalla en blanco. Ahora apunta a `/tournaments`.

### 2. Reconexión automática del WebSocket
Backoff exponencial con jitter (1s → 30s), reintento inmediato al recuperar
conectividad, sin reintento en cierres de autorización. Nuevo hook `onReconnect` para
re-sincronizar estado perdido durante el corte.

### 3. Cola offline de eventos
Nuevo `lib/offlineQueue.ts`. Los eventos que no se pueden enviar se guardan en
`localStorage` con el minuto de partido en que ocurrieron y se reenvían solos.

Cambio de contrato en el backend: `POST /sessions/{id}/events` acepta `timer_seconds` y
`half` opcionales (ambos o ninguno) y los respeta cuando vienen. Sin esto, un evento
diferido quedaba sellado con la hora de la reconexión en vez de la del hecho.

Se agregó `lib/useEventRegistrar.ts` como punto único de registro de eventos, usado por
las tres tabs del tablero.

### 4. Refresh token en el cliente
El backend ya emitía refresh tokens; el frontend los descartaba y deslogueaba duro ante
cualquier 401. Ahora el interceptor renueva y reintenta, con un único refresh en vuelo.

Ver [[offline-resilience]] para el detalle del comportamiento.

---

## Tanda 2 — Corrección y confianza

### 5. Durnin-Womersley con edad y sexo reales
`_calculate_body_fat` recibía un parámetro `age` que **siempre** se llamaba con `None` y
usaba constantes fijas de varón 17-19. El % de grasa era incorrecto para toda jugadora y
todo jugador adulto.

Nuevo módulo `app/core/anthropometry.py` con la tabla completa de coeficientes por sexo y
banda etaria. Además:

- Se agregó el pliegue **bicipital** (migración `0009`), que es el cuarto pliegue
  canónico del método; la app venía midiendo abdominal en su lugar.
- Cada medición guarda `body_fat_method` (`dw4c/F/20-29`) con el juego de pliegues, sexo
  y banda usados, marcando con `*` lo que se asumió por ficha incompleta. Series
  calculadas con distinto juego de pliegues no son comparables, y ahora eso es visible.
- Resultados fuera de rango fisiológico devuelven `None` en lugar de un número inventado.

### 6. Suite de tests
De cero a **140 tests**:

- `backend/tests/` — 99 tests sobre SQLite en archivo temporal, sin dependencias
  externas: antropometría, máquina de estados del timer, auth y rotación de tokens,
  aislamiento multi-tenant, eventos y sellado diferido, divisiones/torneos, performance.
- `frontend/src/lib/*.test.ts` — 41 tests con vitest: cálculo de puntaje y contadores,
  cola offline, interpolación del timer.

**Corrección de modelo derivada de los tests:** las columnas booleanas dependían sólo de
`server_default`, que fuera de Postgres se guarda como texto (`'true'`), con lo que
`.is_(True)` no matchea. Se agregaron defaults del lado del ORM en todos los modelos —
correcto en cualquier motor.

### 7. CI
`.github/workflows/ci.yml`: tests del backend, migraciones de Alembic contra Postgres
real en ambas direcciones (`upgrade head` + `downgrade base`), y typecheck + tests +
build del frontend.

**`npm run build` estaba roto en `main`** por un choque de tipos en `UnifyPlayersModal`
(`dni` requerido vs opcional). Corregido.

### 8. CORS
`allow_origins=["*"]` junto a `allow_credentials=True` es una combinación que la spec de
CORS prohíbe. Ahora los orígenes salen de `CORS_ORIGINS` y `allow_credentials` es `False`
(la API se autentica con Bearer, no con cookies). Sin la variable definida se sigue
aceptando cualquier origen pero el backend lo avisa por log al arrancar, para no romper
deploys existentes de golpe.

---

## Tanda 3 — Completar la gestión

### 9. PATCH/DELETE de divisiones y torneos
Sólo existían `POST` y `GET`: una división creada con un typo quedaba para siempre.

Se agregaron renombrar/editar y baja lógica, con una regla explícita: **no se archiva
algo que todavía tiene contenido activo colgando**. El backend devuelve `409` con la
cuenta exacta (`"La división tiene 12 jugador(es) activo(s)"`). Archivar con contenido
activo lo esconde sin borrarlo, que es peor que no poder archivarlo.

UI correspondiente en Configuración (divisiones) y Torneos.

**Bug encontrado al testear:** con `expire_on_commit=False`, re-seleccionar el torneo
después del commit devolvía la instancia del identity map con la división anterior
todavía cargada. Se resolvió con un `refresh` explícito de la relación.

### 10. Alerta de tiempo reglamentario
`half_duration_minutes` se guardaba y no se usaba en ningún lado. Ahora, al cumplirse,
el reloj pasa a ámbar y muestra el tiempo adicional corrido (`+2:31`). El timer no se
detiene solo: en rugby esa decisión es de quien dirige.

### 11. Documentación
- README reescrito: no mencionaba Plantel, Físico, tests físicos, mediciones, import
  xlsx ni vista de cancha.
- [[data-model]] sincronizado con el schema real (faltaban las cinco tablas de plantel,
  `events.player_id`, y el enum de `team` seguía figurando como `home`/`away`).
- Nueva spec [[offline-resilience]].
- `.env.example` con `CORS_ORIGINS`.

---

## Archivos nuevos

```
backend/app/core/anthropometry.py
backend/alembic/versions/0009_measurement_biceps_and_method.py
backend/tests/{conftest,test_anthropometry,test_timer,test_auth,
               test_multitenancy,test_events,test_divisions_tournaments,
               test_performance_api}.py
backend/{pytest.ini,requirements-dev.txt}
frontend/src/lib/{offlineQueue,timer,authTokens,useEventRegistrar}.ts
frontend/src/lib/{offlineQueue,timer,stats}.test.ts
frontend/vitest.config.ts
.github/workflows/ci.yml
openspec/specs/offline-resilience.md
```

## Pendiente conocido

- **El timer autoritativo vive en memoria del proceso.** Con más de un worker de uvicorn,
  cada proceso tendría su propio timer y su propio tick, y clientes conectados a workers
  distintos verían tiempos distintos. Hoy funciona porque corre un solo worker. Escalar
  horizontalmente requiere mover el estado a Postgres o Redis.
- Archivos monolíticos: `Stats.tsx` (1059), `Tournaments.tsx` (~990), `Configuracion.tsx`
  (~810), `Squad.tsx` (746).
- El bundle del frontend pasa los 3 MB sin code-splitting.
