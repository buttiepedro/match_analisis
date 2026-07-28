---
title: Despliegue
status: active
created: 2026-07-28
---

# Despliegue

> El runbook operativo —los comandos a correr en el servidor— está en
> [`DEPLOY.md`](../../DEPLOY.md). Acá están las decisiones y por qué.

Hasta este cambio existían cinco módulos y ningún lugar donde el club pudiera
entrar. Todo corría en la máquina de desarrollo.

## Un solo origen

Frontend y API se sirven del mismo dominio. La API cuelga de `/api` y **Caddy le
saca el prefijo** antes de pasarla al backend:

```
handle_path /api/* {
	reverse_proxy backend:8000
}
```

Dos consecuencias que valen el diseño entero:

- **El backend no se entera.** Sus rutas siguen siendo `/auth`, `/clubs`,
  `/job-posts`; los tests que las usan siguen valiendo tal cual. No hay un
  prefijo que exista en producción y no en los tests.
- **No hay CORS.** `CORS_ORIGINS` va vacío porque no hay pedido cruzado que
  permitir. Es una clase entera de errores de configuración que deja de existir.

La alternativa era enumerar en el proxy los 19 prefijos de primer nivel que
sirve el backend. Eso significa volver a editar el proxy cada vez que aparece un
módulo —esta misma sesión agregó `job-posts`— y olvidarse da un 404 que parece
un bug del frontend.

Del lado del cliente no hizo falta tocar llamadas: `VITE_API_URL=/api` alcanza,
porque axios y el WebSocket ahora resuelven su base en un módulo compartido
(`lib/apiBase.ts`). Antes cada uno la deducía por su cuenta y ya discrepaban —el
WebSocket caía a `window.location` y axios no.

## Producción es un archivo aparte, no un override

`docker-compose.prod.yml` es autónomo en vez de un `-f base -f override`. La
diferencia que lo justifica: **el compose de desarrollo publica el 5432**. En un
servidor con IP pública eso es Postgres en internet. Si producción fuera un
override, la seguridad de la base dependería de acordarse de pasar los dos `-f`
en el orden correcto.

En producción **sólo Caddy publica puertos** (80, 443, 443/udp). Base, backend y
frontend se hablan por la red interna de compose.

## El backend se niega a arrancar con secretos de ejemplo

Con `ENVIRONMENT=production`, `SECRET_KEY` o `SUPERADMIN_PASSWORD` con un valor
de `.env.example` —o demasiado cortos— tiran el arranque, y el error incluye un
secreto recién generado para copiar.

El modo de falla que esto ataca no es un bug: es el despliegue apurado que copia
el ejemplo, cambia lo que rompe al arrancar y deja lo que no rompe. Con la clave
de ejemplo **la app funciona perfecto**, firmando tokens con un secreto que está
publicado en el repo. Fallar al arrancar es incómodo, pero se ve.

Por la misma lógica, `cors_origins` sin configurar se **invierte** según el
entorno: `["*"]` en desarrollo, `[]` en producción. Un default permisivo que en
desarrollo es cómodo, en producción es dejar que cualquier página del mundo le
hable a la API con el token del socio.

## Dos chequeos de salud, no uno

| | Qué responde | Toca la base |
|---|---|---|
| `/health` | ¿el proceso vive? | no |
| `/health/ready` | ¿puede atender un request? | sí |

Si `/health` consultara la base, un rato de base caída haría que el orquestador
reiniciara en loop un backend que no tiene nada malo — y reiniciarlo no arregla
una base caída, sólo agrega caídas. El healthcheck de compose mira
`/health/ready`, que es la pregunta que importa para mandarle tráfico.

## Backups

Uno por día, retención de 14, a `./backups` en el host.

Dos cuidados que separan un backup de un archivo:

1. **Se escribe a un temporal y se renombra al final.** Un `pg_dump` cortado por
   la mitad deja un `.gz` truncado; con el nombre definitivo ya puesto sería
   indistinguible de uno bueno hasta el día que hay que usarlo.
2. **Se verifica antes de aceptarlo** (`gzip -t` y un piso de tamaño). La
   retención borra sólo backups verificados: si el de hoy falló, los viejos se
   quedan.

El servicio **espera a que exista el schema** antes del primer dump. Arranca
apenas la base responde, que es antes de que el backend migre; sin esperar, todo
despliegue nuevo empezaba con un error que no era un error.

### Restaurar exige el backend apagado

El script se niega si hay otra conexión contra la base. No es por locks —las
conexiones ociosas del pool quedan en `idle` fuera de transacción y no bloquean
nada; se midió—. Es porque **el backend sigue atendiendo durante el restore**:
escribe sobre un schema a medio reemplazar y le contesta a los usuarios con
datos que están por desaparecer, sin que aparezca un error en ningún lado. Matar
las conexiones y seguir sería peor: el pool reconecta a los pocos segundos.

Antes de pisar nada, guarda un dump del estado actual. Si el backup elegido era
el equivocado, todavía hay a dónde volver.

## Qué se verificó y qué no

Levantando el stack completo (`APP_DOMAIN=:80`, HTTP plano):

- Ruteo: raíz al frontend, `/api/*` al backend, `/bolsa` cae en el SPA y no en
  un 404, cabeceras de seguridad presentes y `Server` removida.
- Login, endpoint autenticado con las 29 capacidades, y 403 sin token.
- **WebSocket del cronómetro a través del proxy**: `101 Switching Protocols` y
  el estado inicial del timer. Es el único camino que necesita upgrade.
- Postgres no alcanzable desde el host.
- Backup: dump verificado, retención, y descarte del dump sospechoso.
- **Restore completo**: se creó un club después del snapshot, se restauró, el
  club desapareció y los anteriores volvieron. La app siguió sana después.

Lo único que **no** se pudo probar es la emisión del certificado, que necesita un
dominio público.

## Fuera de alcance

| Qué | Por qué no |
|-----|-----------|
| **Copia de los backups fuera del servidor** | `./backups` vive en el mismo disco que la base: un disco muerto se lleva las dos cosas. Depende de dónde esté hosteado (rclone, el backup del proveedor), así que queda documentado en `DEPLOY.md` en vez de elegido acá |
| **Despliegue automático desde CI** | Con un solo servidor, un `git pull` y un `up -d --build` alcanzan. Automatizarlo antes de tener a dónde desplegar es adivinar |
| **Métricas y alertas** | Primero hay que tener uso real que mirar |

## Relacionado

- [[architecture]] — cómo está partida la app
- [[socios]] — el módulo que espera un padrón real para terminar de validarse
- [[add-plataforma-club-roadmap]] — el programa que dejó los cinco módulos listos
