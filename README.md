# Rule34Video – plugin de Kino (v1.2.0)

Fuente de video para [rule34video.com](https://rule34video.com).

## Qué hace

- **Búsqueda** por título, tags o artistas (máx. 80 caracteres).
- **Inicio**:
  - **Mis favoritos** (solo con sesión iniciada)
  - **3D** (categoría del sitio)
  - Lo más nuevo / Mejor valorados / Más populares
- **Calidad**: mejor disponible, 1080p, 720p, 480p o 360p.
- Login opcional: si falla, los videos públicos siguen funcionando.
- Contenido `adult: true`.

## Instalar / actualizar

1. Sube la carpeta a GitHub (público, topic `kino-plugin`) o reinstala en Kino.
2. Si ves *«Este plugin ya no tiene este título»*: actualiza el plugin y abre el video otra vez desde **Buscar** o **Inicio** (los de «Continuar viendo» de una versión anterior pueden quedar huérfanos).

## Cambios 1.2.0

- Login suave (no bloquea reproducción pública).
- Extracción de calidades reforzada (download + flashvars + JSON-LD).
- Fallback `/video/` y `/videos/`.
- Headers Referer/User-Agent en el stream.
- Sección **3D** en Inicio.
