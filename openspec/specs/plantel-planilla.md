---
title: Plantel en planilla — exportar, editar, volver a cargar
status: active
created: 2026-07-28
---

# Plantel en planilla

> Refleja lo implementado en `api/v1/import_.py` y `pages/Squad.tsx`.

Exportar el plantel a `.xlsx`, corregirlo en Excel y volver a subirlo. Editar
treinta jugadores de a uno en el celular no lo hace nadie.

## Las dos columnas que hacen posible la vuelta

La planilla no trae sólo datos del jugador: trae dos columnas que identifican la
**fila**.

### `ID`

El identificador interno. El importador lo mira **primero**, antes que el DNI.

Sin él, el match es por DNI, y eso rompe el ciclo de dos maneras:

- Un jugador **sin DNI** no tiene con qué reconocerse, así que se duplica en cada
  vuelta.
- **Corregirle un DNI mal cargado** crea un jugador nuevo y deja el viejo con el
  documento equivocado — que es exactamente el problema que uno abrió la planilla
  para arreglar, ahora duplicado.

Un `ID` que no pertenece al club se **rechaza con error** en vez de crear un
jugador suelto: casi siempre es una planilla de otro club o una fila copiada a
mano.

### `División`

Permite exportar el club entero en un archivo y que cada fila vuelva a su lugar.
Cambiarla mueve al jugador, que es una forma cómoda de armar la pretemporada.

El `division_id` del formulario pasa a ser opcional: si la fila trae división,
manda la fila. Una planilla propia sin esa columna sigue funcionando como antes.

## Peso y estatura no se apilan

Si vienen, se escribe la medición **del día**, pisando la que ya exista para esa
fecha en vez de agregar otra.

Antes se agregaba siempre. Subir dos veces la misma planilla —lo normal cuando se
corrige una fila y se vuelve a cargar— dejaba dos mediciones idénticas del mismo
día, y la evolución de peso pasaba a tener escalones que nadie midió.

## Alcance

Exportar exige `plantel.ver`; importar sigue exigiendo `plantel.importar`. Un
entrenador con divisiones asignadas exporta **las suyas**: el alcance por división
vale igual acá que en la pantalla.

## Detalle de implementación

El archivo se devuelve con `Response` y no con `StreamingResponse`: ya está entero
en memoria, así que no hay nada que mandar de a pedazos, y streamearlo retrasa el
cierre de la sesión de base hasta que termina de salir el cuerpo.

## Relacionado

- [[data-model]] — el modelo de jugador
- [[club-operativo]] — alcance por división
- [[socios]] — el otro flujo de planilla del club, con reglas propias
