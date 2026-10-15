# Rule34Video – plugin de Kino (v1.3.0)

Fuente de video para [rule34video.com](https://rule34video.com).

## Qué hace

- Búsqueda por título, tags o artistas (máx. 80 caracteres).
- Inicio: favoritos (con sesión), lo más nuevo, mejor valorados, más populares, **3D al final**.
- Calidad configurable; login opcional sin bloquear videos públicos.
- Contenido `adult: true`.

## Corrección 1.3.0 (error «ya no tiene este título»)

El sitio responde **404** en `/video/{id}/` sin slug. Ahora `resolve` usa:

1. `/popup-video/{id}/` (funciona solo con el ID)
2. `/video/{id}/{slug}/` si el ref trae slug
3. Fallbacks antiguos

Los ítems guardan `ref` como `id/slug` cuando está disponible.

## Instalar

Reinstala o actualiza el plugin en Kino. Abre videos desde **Buscar** o **Inicio** (no desde «Continuar viendo» de una versión anterior).
