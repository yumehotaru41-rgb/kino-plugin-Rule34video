# Rule34Video – plugin de Kino

Fuente de video para [rule34video.com](https://rule34video.com).

## Qué hace

- **Búsqueda** por título, tags o artistas (consulta limitada a 80 caracteres).
- **Inicio** con filas: Lo más nuevo, Mejor valorados, Más populares.
- **Mis favoritos**: fila en Inicio **solo si inicias sesión** (usuario y contraseña en ajustes).
- **Calidad de video** configurable: mejor disponible, 1080p, 720p, 480p o 360p.
- **Inicio de sesión** opcional (usuario / contraseña del sitio).
- Contenido marcado como `adult: true`.

## Instalar en Kino

1. Publica este repositorio en GitHub (público) con el topic `kino-plugin`.
2. En Kino: **Ajustes → Plugins → Agregar** y escribe `usuario/repo`.
3. Acepta los hosts y, si quieres, configura calidad e inicia sesión.

## Probar en local

Con el SDK de Kino (carpeta `sdk/` de cualquier plantilla oficial):

```bash
node sdk/validate.mjs .
node sdk/run.mjs . search "anime"
node sdk/run.mjs . resolve 3065157
```

## Notas

- Los enlaces de reproducción usan los tokens del sitio (`v-acctoken`); caducan tras un tiempo.
- No se necesita cuenta para buscar ni reproducir la mayoría de videos públicos.
- La fila **Mis favoritos** solo aparece cuando hay sesión válida y el sitio devuelve favoritos.
- `streamHosts: "any"` está declarado porque los `get_file` pueden salir de hosts variables del CDN del sitio.
