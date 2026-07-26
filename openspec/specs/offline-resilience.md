---
title: Resiliencia en Cancha
status: active
created: 2026-07-25
---

# Resiliencia en Cancha

## Problema

La app se usa parado al costado de una cancha, con 4G intermitente y partidos de 80
minutos. Tres cosas la volvían inservible en ese contexto:

1. Un `POST /events` que fallaba por red **perdía el evento**, sin aviso ni reintento.
2. El WebSocket no reconectaba: al primer corte quedaba "Desconectado" hasta recargar.
3. El access token vencía a los 60 minutos y el cliente deslogueaba de una — a mitad
   del segundo tiempo, con el analista perdiendo el contexto del partido.

Ninguna es un caso raro: las tres pasan en un domingo normal.

## Principio

**Un evento registrado no se pierde nunca, y conserva el minuto de partido en que ocurrió.**

Todo lo demás se deriva de eso.

---

## Cola offline de eventos

`frontend/src/lib/offlineQueue.ts`

### Encolado

Un evento se encola cuando, y sólo cuando, el envío falló por **red**:

- `navigator.onLine === false` → se encola sin intentar la request.
- El POST rechaza **sin** `error.response` (la request nunca llegó) → se encola.
- El POST rechaza **con** `error.response` (403, 422, …) → **no** se encola; el error se
  propaga a la UI. Reintentar un rechazo del servidor lo dejaría trabado para siempre.

La cola vive en `localStorage` bajo `match_analisis:event_queue:v1` y sobrevive a
recargas y a cerrar el navegador.

### Sellado de tiempo

Al encolar se agregan `timer_seconds` y `half` calculados en el cliente
(`lib/timer.ts::timerStamp`). El backend, en `POST /sessions/{id}/events`:

- Si llegan **ambos**, los respeta: el evento queda con el minuto real del hecho.
- Si falta alguno, los ignora y sella con su propio timer.

Cuando **hay** conexión el cliente no manda el sello: el timer del servidor es la fuente
autoritativa y evita arrastrar el desfasaje de reloj del celular.

### Vaciado

Se dispara al recuperar conectividad (`window.online`), al reconectar el WebSocket, cada
15 s mientras quede algo pendiente, y manualmente desde el indicador del header.

El vaciado respeta el orden de registro. Ante una falla de red **corta** y deja el resto
para el próximo intento; ante un rechazo del servidor **descarta ese ítem** (con un
`console.warn`) y sigue con los demás.

### Reflejo en la UI

Un evento encolado se agrega al store con id local `local:<ts>:<rand>` y `pending: true`,
para que los contadores del tablero no se queden atrás. Se muestra con ⧗ en el registro
de eventos, y el header indica cuántos faltan enviar.

Borrar un evento pendiente lo saca de la cola sin llamar a la API — no existe en el
servidor todavía.

Después de un vaciado exitoso, la pantalla de sesión vuelve a pedir los eventos y
reemplaza los locales por los reales, **conservando** los que sigan en cola.

---

## Reconexión del WebSocket

`frontend/src/lib/ws.ts`

- Backoff exponencial con jitter: 1s → 2s → 4s → 8s → 16s → 30s (tope).
  El jitter evita que todos los clientes de un partido reconecten en el mismo instante
  cuando el backend se reinicia.
- `window.online` fuerza un reintento inmediato, sin esperar al backoff.
- Los cierres 4001–4004 (token inválido, sin acceso, sesión inexistente) **no** se
  reintentan: reintentar no cambia el resultado.
- El cierre manual (`disconnect()`) no dispara reintento.
- `onReconnect` distingue una re-apertura de la conexión inicial: es el gancho para
  vaciar la cola y re-sincronizar lo que pasó durante el corte.

---

## Renovación de sesión

`frontend/src/lib/axios.ts` + `frontend/src/lib/authTokens.ts`

- El login guarda **access y refresh token**. `authTokens.ts` es el único dueño de
  `localStorage`; vive fuera del store de Zustand porque el interceptor de axios necesita
  rotarlos sin importar el store (que a su vez importa axios).
- Ante un 401 el interceptor renueva el access token y **reintenta la request original**
  una sola vez (`_retried`).
- **Un único refresh en vuelo**: si diez requests fallan a la vez —habitual en el tablero,
  que dispara varias en paralelo— todas esperan la misma promesa en lugar de quemar el
  refresh token diez veces.
- Sólo se cierra sesión si el refresh también falla.
- El logout revoca el refresh token en el servidor; si eso falla (sin red, token vencido)
  igual se limpia la sesión local.

---

## Tiempo reglamentario

El timer **no se detiene solo** al cumplirse `half_duration_minutes`: en rugby el tiempo
adicional lo decide quien dirige. Lo que hace la UI es marcarlo — reloj en ámbar y
contador `+MM:SS` del tiempo corrido de más — para que nadie tenga que llevar la cuenta
mentalmente.

---

## Verificación

| Comportamiento | Test |
|----------------|------|
| Encolado por red / rechazo del servidor | `frontend/src/lib/offlineQueue.test.ts` |
| Orden, corte y descarte en el vaciado | `frontend/src/lib/offlineQueue.test.ts` |
| Persistencia en `localStorage` y tolerancia a datos corruptos | `frontend/src/lib/offlineQueue.test.ts` |
| Interpolación y sellado de tiempo | `frontend/src/lib/timer.test.ts` |
| El backend respeta el sello diferido | `backend/tests/test_events.py` |
| El backend ignora un sello incompleto | `backend/tests/test_events.py` |
| Refresh emite un token usable y el logout lo revoca | `backend/tests/test_auth.py` |

## Relacionado

- [[match-session]] — timer y registro de eventos
- [[data-model]] — separación entre `timer_seconds` y `recorded_at`
- [[auth-and-users]] — roles y tokens
