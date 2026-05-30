---
title: Autenticación y Jerarquía de Usuarios
status: active
created: 2026-05-29
---

# Autenticación y Jerarquía de Usuarios

## Visión General

El sistema es multi-tenant con tres niveles de rol. El acceso a datos está siempre acotado al club al que pertenece el usuario. No hay mezcla de datos entre clubes.

## Jerarquía de Roles

```
SUPERADMIN  (definido en .env del backend)
    │
    └── puede crear: Clubes
    └── puede ver: todos los clubes y sus datos

CLUB_ADMIN  (creado por superadmin al crear el club)
    │
    └── puede crear: Usuarios, Divisiones, Torneos
    └── puede ver: solo su club
    └── puede gestionar: sesiones y partidos de su club

MATCH DIRECTOR  (creado por club_admin)
    │
    └── puede registrar: eventos en sesiones activas de su club
    └── puede ver: estadísticas de su club
    └── NO puede: crear usuarios, divisiones ni torneos
    └── Puede controlar el timer
    
ANALYST (creado por club_admin)
    └── puede registrar: eventos en sesiones activas de su club
    └── NO puede: crear usuarios, divisiones ni torneos ni controlar timer
```

## Autenticación

- JWT Bearer Token (access token con expiración corta + refresh token)
- Login via email + contraseña
- El superadmin se crea automáticamente al iniciar el backend si no existe (seed desde .env)
- Variables de entorno requeridas:
  ```
  SUPERADMIN_EMAIL=admin@example.com
  SUPERADMIN_PASSWORD=changeme
  SECRET_KEY=...
  ACCESS_TOKEN_EXPIRE_MINUTES=60
  REFRESH_TOKEN_EXPIRE_DAYS=7
  ```

## Endpoints de Auth

| Método | Ruta | Descripción | Acceso |
|--------|------|-------------|--------|
| POST | `/auth/login` | Login, retorna tokens | Público |
| POST | `/auth/refresh` | Renovar access token | Autenticado |
| POST | `/auth/logout` | Invalidar refresh token | Autenticado |
| GET | `/auth/me` | Datos del usuario actual | Autenticado |

## Endpoints de Gestión de Usuarios

| Método | Ruta | Descripción | Acceso |
|--------|------|-------------|--------|
| POST | `/clubs` | Crear club | SUPERADMIN |
| GET | `/clubs` | Listar clubes | SUPERADMIN |
| POST | `/clubs/{club_id}/users` | Crear usuario en club | CLUB_ADMIN |
| GET | `/clubs/{club_id}/users` | Listar usuarios del club | CLUB_ADMIN |
| PATCH | `/clubs/{club_id}/users/{user_id}` | Editar usuario | CLUB_ADMIN |
| DELETE | `/clubs/{club_id}/users/{user_id}` | Desactivar usuario | CLUB_ADMIN |

## Reglas de Negocio

1. Un usuario pertenece a exactamente un club
2. El `club_admin` se crea junto con el club por el `superadmin`
3. Un `analyst` no puede cambiar su propio rol
4. Las cuentas se desactivan (soft delete), no se eliminan
5. El `superadmin` no pertenece a ningún club

## Pantallas Frontend

- `/login` — formulario de login
- `/admin/clubs` — (superadmin) lista y creación de clubes
- `/admin/users` — (club_admin) lista y creación de usuarios del club

## Relacionado

- [[architecture]] — configuración general del sistema
- [[data-model]] — entidades User, Club, Role
