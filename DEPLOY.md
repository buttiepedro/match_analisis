# Poner la app en producción

Todo lo de acá se probó levantando el stack completo, no sólo leyéndolo. Lo que
**no** se pudo probar sin un dominio real está marcado como tal.

Hace falta un servidor Linux con Docker, y un dominio apuntando a su IP.

---

## 1. Antes de tocar nada

El dominio tiene que resolver a la IP del servidor **antes** del primer arranque:
Caddy pide el certificado apenas levanta y Let's Encrypt valida entrando por el
puerto 80. Si el DNS todavía no propagó, el arranque falla pidiendo el
certificado y hay que esperar igual.

Los puertos 80 y 443 tienen que estar abiertos. El 443 también en UDP, para
HTTP/3.

## 2. Configuración

```sh
git clone <repo> && cd match_analisis
cp .env.production.example .env.production
chmod 600 .env.production          # tiene la contraseña de la base
```

Editá `.env.production` y reemplazá todo lo que dice `CAMBIAR`. La clave de
sesiones se genera con:

```sh
python3 -c "import secrets; print(secrets.token_urlsafe(48))"
```

**El backend se niega a arrancar si quedó algún valor de ejemplo.** No es una
advertencia en un log: no levanta. Es a propósito — arrancar con la clave que
está publicada en el repo significa firmar las sesiones con un secreto que
cualquiera puede leer, y eso no se nota hasta que alguien entra.

`DATABASE_URL` tiene que repetir la misma contraseña que `POSTGRES_PASSWORD`.
Es el olvido más común.

## 3. Arrancar

```sh
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

Las migraciones corren solas al arrancar el backend, y el superadmin se crea si
no existe. No hay ningún paso manual de base de datos.

Verificá:

```sh
docker compose -f docker-compose.prod.yml --env-file .env.production ps
curl -s https://TU-DOMINIO/api/health/ready
```

`{"status":"ok","database":"ok"}` significa que el backend llega a la base. El
servicio `backend` figura como `healthy` recién cuando eso responde: `/health`
solo dice que el proceso vive, y un backend con la base caída también vive.

Entrá a `https://TU-DOMINIO`, logueate con el superadmin y **cambiale la
contraseña**.

## 4. Qué queda expuesto

Sólo Caddy publica puertos (80, 443). La base, el backend y el frontend no son
alcanzables desde afuera: se hablan por la red interna de compose.

> El `docker-compose.yml` de desarrollo publica el 5432. En un servidor con IP
> pública eso es Postgres en internet. Por eso producción es un archivo aparte y
> no un `override`: la diferencia es demasiado importante para que dependa de
> acordarse de pasar dos `-f`.

El frontend y la API comparten dominio — la API cuelga de `/api` y Caddy le saca
el prefijo antes de pasarla al backend. No hay CORS que configurar, y por eso
`CORS_ORIGINS` va vacío.

## 5. Backups

Salen solos: uno por día, se guardan los últimos 14, van a `./backups` en el
host. Se configuran con `BACKUP_EVERY_SECONDS` y `BACKUP_KEEP`.

```sh
docker compose -f docker-compose.prod.yml --env-file .env.production logs backup
ls -lh backups/
```

Cada dump se escribe a un temporal, se verifica y recién entonces se renombra:
un `pg_dump` cortado a la mitad nunca queda con nombre de backup bueno.

**`./backups` está en el mismo disco que la base.** Un disco que se muere se
lleva las dos cosas. Copiar esa carpeta a otro lado —`rclone`, `rsync`, el
backup del proveedor— es lo que falta para que esto sea un backup de verdad, y
no está automatizado acá porque depende de dónde esté hosteado.

### Restaurar

Probalo **ahora**, no el día del incidente. El backend tiene que estar apagado:

```sh
DC="docker compose -f docker-compose.prod.yml --env-file .env.production"

$DC stop backend
$DC run --rm --entrypoint /bin/sh -T backup /ops/restore.sh /backups/ARCHIVO.sql.gz
$DC start backend
```

El script pide confirmación, y antes de pisar nada guarda un dump del estado
actual en `backups/.pre-restore-*.sql.gz`: si el backup elegido resultó ser el
equivocado, todavía hay a dónde volver.

Si el backend quedó prendido, el script se niega y te dice esto mismo. No es
paranoia: durante el restore el backend sigue atendiendo, escribiendo sobre un
schema a medio reemplazar y contestándole a los usuarios con datos que están por
desaparecer, sin que aparezca un error en ningún lado.

> El `--entrypoint /bin/sh` no es opcional. Sin eso, `docker compose run` pisa
> el *command* del servicio pero no el entrypoint: corre el backup en loop y
> ignora los argumentos en silencio.

## 6. Actualizar

```sh
git pull
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

Las migraciones corren en el arranque. Antes de una actualización con
migraciones nuevas conviene forzar un backup y esperar a que aparezca el
archivo.

## 7. Logs

```sh
DC="docker compose -f docker-compose.prod.yml --env-file .env.production"
$DC logs -f backend
$DC exec caddy cat /var/log/caddy/access.log
```

Los de Caddy rotan a los 20 MB y guarda 10.

---

## Probar sin dominio

Para una prueba en la red interna del club, poné `APP_DOMAIN=:80`. Caddy sirve
por HTTP plano, sin certificado. Sirve para ver la app andando; **no** para
cargar el padrón real: por HTTP los DNIs y las contraseñas viajan en claro.

Así se verificó todo lo de este documento salvo la emisión del certificado, que
necesita un dominio público.

---

## Lo que falta decidir con el club

Ninguna de las dos se arregla escribiendo código:

1. **Los socios cadetes son menores.** Datos de tutor y consentimiento de
   imagen. Hoy el importador los carga como a cualquier otro socio.
2. **El importador nunca vio un padrón real.** Antes de la primera importación
   en serio, corré el archivo del sistema contable con `dry_run`: reporta qué
   haría sin escribir nada. Para eso está.
