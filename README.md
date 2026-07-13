# 🐄 Ganadería La Piedad

App de gestión para la finca: hato, reproducción y pesajes.
(Las finanzas se llevan aparte, en Google Sheets.)
Funciona como PWA — se instala desde el navegador del celular con
"Agregar a pantalla de inicio" y sigue funcionando sin señal.

- **HTML/CSS/JS puro**, sin dependencias ni build.
- Datos locales en IndexedDB, con respaldo/restauración JSON.
- Informes en PDF (imprimir/guardar) y exportación a Excel (CSV).

## Desarrollo local

```
python -m http.server 8123 --directory .
```

Al editar cualquier archivo, subir la versión `CACHE` en `sw.js` para que
los dispositivos instalados se actualicen.
