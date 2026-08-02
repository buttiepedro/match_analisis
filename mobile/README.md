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

- `EXPO_PUBLIC_API_URL` apunta al backend — puede ser `http://localhost:8000`,
  la IP de tu red local, o directamente la URL de producción (Railway, por
  ejemplo). Con Expo Go en un teléfono real, `localhost` no sirve: el
  teléfono no es la misma máquina que corre el servidor.
- Con el emulador de **Android**, `localhost` no llega a la máquina host:
  usar `http://10.0.2.2:8000`. El simulador de **iOS** y `--web` sí
  resuelven `localhost` directo.
- Verificado con Expo Go en un iPhone real (además de `expo start --web` +
  Playwright, que fue la única forma disponible en el entorno donde se
  escribió el código originalmente — sin macOS ni Android SDK instalados
  ahí). Antes de un cambio grande, correr al menos `--web` y mirar la
  consola del browser sigue atrapando bugs reales (mismo patrón que ya
  viene funcionando en `frontend/`).
- **El SDK de Expo está fijado a lo que Expo Go sirve en las tiendas
  (hoy, SDK 54), no al último release.** Subir el SDK sin chequear esto
  rompe la conexión de cualquier dispositivo real con
  `Project is incompatible with this version of Expo Go` — ver
  `openspec/specs/app-movil.md`, "El SDK de Expo se fija a lo que soporta
  Expo Go".

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
