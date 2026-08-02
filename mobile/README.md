# App móvil — portal del socio y del jugador

Segundo frontend, mismo backend que `../backend`. Sin lógica de negocio
propia: consume la misma API REST que `../frontend`. Ver
[`openspec/specs/app-movil.md`](../openspec/specs/app-movil.md) para el
porqué de las decisiones.

**No entra en `docker-compose.yml`** — Expo se corre y se compila con su
propio tooling, no en un contenedor.

## Alcance de esta v1

Sólo el portal de socio y jugador: fixture, tablas, citados, tu ficha o tu
cuota, gimnasio propio, bolsa de trabajo, turnos de nutrición y
notificaciones. **No** incluye el tablero de partido (timer, eventos,
lineup en vivo) — es su propio programa futuro, ver el spec.

## Levantar en desarrollo

```sh
cd mobile
npm install
EXPO_PUBLIC_API_URL=http://localhost:8000 npx expo start
```

- `EXPO_PUBLIC_API_URL` apunta al backend. Sin configurar, usa
  `http://localhost:8000`.
- Con el emulador de **Android**, `localhost` no llega a la máquina host:
  usar `http://10.0.2.2:8000`. El simulador de **iOS** y `--web` sí
  resuelven `localhost` directo.
- `npx expo start --web` es la única forma en que esta app se verificó en
  este repo hasta ahora — no hay macOS ni Android SDK instalados en el
  entorno donde se escribió. Antes de un cambio grande, correrlo así y
  mirar la consola del browser sigue atrapando bugs reales (mismo patrón
  que ya viene funcionando en `frontend/`).

## Qué falta para publicar en las tiendas

Nada de esto se hizo en esta sesión — necesita cuentas y credenciales que
no están disponibles acá. Ver `openspec/specs/app-movil.md`, "Qué falta
para publicar":

- Cuenta de Expo (`eas init`) para tener un `projectId` real — sin eso,
  `expo-notifications` no puede pedir un token de push (`push.ts` lo
  detecta y no hace nada, no revienta).
- Cuenta de Apple Developer Program y de Google Play Developer.
- Ícono, splash, screenshots, política de privacidad.
- `EAS Build` + `EAS Submit`.
