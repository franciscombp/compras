# 🚀 Guía de Deploy — Quanto en GitHub Pages

## ¿Dónde está publicado?

La app está lista para ser publicada automáticamente en:
```
https://franciscombp.github.io/quanto/
```

## Configurar GitHub Pages (una sola vez)

### 1. En GitHub.com, ve a tu repositorio

```
https://github.com/franciscombp/quanto
```

### 2. Settings → Pages

**Ruta**: Settings (ícono ⚙️ arriba a la derecha) → Pages (en el menú izquierdo)

### 3. Configura "Source"

- **Build and deployment**
  - Source: `Deploy from a branch`
  - Branch: `main` (la rama que acabamos de crear)
  - Folder: `/ (root)`

### 4. Guardar

GitHub automáticamente:
- ✅ Detecta cambios en `main`
- ✅ Publica la app en `https://franciscombp.github.io/quanto/`
- ✅ Actualiza cada vez que hagas `git push origin main`

---

## Flujo de desarrollo (ahora simplificado)

### Antes (complicado)
```
main (producción) ← pull request ← feature/xyz
```

### Ahora (simple)
```
main → git push → GitHub Pages actualiza automáticamente
```

**Todos los cambios van directamente a `main`:**

```bash
# 1. Haz cambios
echo "mejora" >> archivo.js

# 2. Commit pequeño y claro
git add -A
git commit -m "Mejorar parser OCR

- Entiende precio por kg impreso
- Detecta packs automáticamente"

# 3. Push a main
git push origin main

# 4. GitHub Pages se actualiza en ~1 minuto
# Visita: https://franciscombp.github.io/quanto/
```

---

## Commits en `main`

**Regla de oro**: cada commit debe ser:
- ✅ Pequeño (1-2 cambios relacionados, máx 50 líneas)
- ✅ Claro (descripción de qué y por qué)
- ✅ Funcional (la app sigue funcionando offline)
- ✅ Testeado (probaste en mobile antes de pushear)

**Ejemplo de buenos commits:**

```bash
git commit -m "Agregar validación a wizard paso 1

- Nombre requiere mín 2 caracteres
- Botón 'Siguiente' deshabilitado si está vacío"

git commit -m "Mejorar readabilidad de barras comparativas

- Ahora visible en dark mode
- Colores actualizados para mejor contraste"
```

**Evitar:**

```bash
git commit -m "Update" # ❌ Vacío
git commit -m "Fix stuff and other things" # ❌ Vago
```

---

## Revertir un commit (si algo se rompe)

Si pusheaste algo y se rompió:

```bash
# Ver últimos commits
git log --oneline -5

# Revertir el último commit
git revert HEAD
git push origin main

# Revertir un commit específico
git revert <hash>
git push origin main
```

**Nota**: `revert` crea un commit nuevo que "deshace" los cambios (seguro).
No uses `reset --hard` en `main` (destruye historial).

---

## Monitorear el deploy

### Verificar que se publicó

1. Abre tu app: https://franciscombp.github.io/quanto/
2. Abre DevTools (F12)
3. Ve a **Application** → **Service Workers**
4. Verifica que hay un SW registrado

### Ver historial de deploys

En GitHub.com:
- **Settings** → **Pages** → scroll abajo
- Ves la fecha del último deploy y el estado ✅

---

## Estructura de URLs

La app detecta automáticamente el path base (`/quanto/`) gracias a:
- `manifest.json`: `"start_url": "/quanto/"`
- `assets/sw.js`: usa `self.location` para detectar scope
- Funciona igual en `http://localhost:8000/` y en GitHub Pages

---

## Troubleshooting

### "El cambio no aparece en GitHub Pages"

1. ✅ Verificaste que `git push origin main` salió bien
2. ✅ Esperaste ~1 minuto
3. ✅ Limpiaste cache del navegador (Ctrl+Shift+R o Cmd+Shift+R)
4. ✅ Abriste incógnito (a veces el cache persiste)

### "No se carga la app"

1. Ve a https://github.com/franciscombp/quanto/settings/pages
2. Verifica que Source sea `main` / `root`
3. Busca errores en el build (GitHub muestra un ❌ si falla)

### "Funciona offline pero offline falla"

El Service Worker puede necesitar actualización:
1. DevTools → Application → Service Workers
2. Click "Unregister"
3. Reload la página
4. SW se registra de nuevo con la versión nueva

---

## Commits automáticos útiles (futuros)

Si en el futuro quieres automatizar el deploy:

```yaml
# .github/workflows/pages.yml (opcional, GitHub lo hace automático)
name: Deploy to Pages
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/configure-pages@v3
      - uses: actions/upload-pages-artifact@v1
      - uses: actions/deploy-pages@v1
```

Pero **no es necesario**: GitHub Pages hace esto automáticamente con la rama.

---

## Resumen

| Antes | Ahora |
|-------|-------|
| Feature branches + PRs | Commits directo a `main` |
| Review lento | Push → 1 min en GitHub Pages |
| Historial confuso | Historial lineal y claro |
| Múltiples ramas | Una sola: `main` |

**Desarrolla rápido, pushea pequeño, itera en GitHub Pages.**
