# ⚙️ Configuración de GitHub Pages — Paso a paso

## TL;DR

1. Ve a https://github.com/franciscombp/quanto/settings/pages
2. Source: `Deploy from a branch`
3. Branch: `main`
4. Folder: `/ (root)`
5. Click Save
6. Espera 1 minuto
7. Tu app está en: https://franciscombp.github.io/quanto/ ✅

---

## Instrucciones detalladas

### Paso 1: Abre Settings

En https://github.com/franciscombp/quanto:
- Click en ⚙️ **Settings** (arriba a la derecha)

### Paso 2: Ve a Pages

En el menú izquierdo (Code and automation section):
- Click en **Pages**

### Paso 3: Configura Build and deployment

Bajo "Source":
- Selecciona: **Deploy from a branch** (no GitHub Actions)

Bajo "Branch":
- Branch: **main**
- Folder: **/ (root)**

### Paso 4: Save

Click en **Save** (si aparece)

---

## ¿Qué pasa después?

GitHub automáticamente:

1. **Detecta cambios** en la rama `main`
2. **Publica en 30-60 segundos** a: https://franciscombp.github.io/quanto/
3. **Vuelve a hacer esto** cada vez que hagas `git push origin main`

---

## Verificar que funciona

### 1. Check the deployment

En Settings → Pages, deberías ver:
```
✅ Your site is live at https://franciscombp.github.io/quanto/
```

### 2. Abre la app

Visita: https://franciscombp.github.io/quanto/

Deberías ver:
- ✅ Pantalla de inicio con "Quanto"
- ✅ Icono en pestaña del navegador
- ✅ Funciona offline (Service Worker)

### 3. Verifica el Service Worker

En la app (cualquier pantalla):
1. Abre DevTools (F12)
2. Ve a: **Application** → **Service Workers**
3. Deberías ver un SW con estado "activated and running"

---

## Qué sucede con cada push

**Antes:**
```bash
git push origin main
```

**Después (automático):**
- GitHub detecta el push
- GitHub Actions (workflow `pages.yml`) se dispara
- Copia todos los archivos a GitHub Pages
- Tu app se actualiza en ~1 minuto

**No necesitas hacer nada más** — es automático.

---

## Solucionar problemas

### "Dice that it's live pero no carga"

1. Espera 2 minutos (a veces tarda más)
2. Limpia cache del navegador: Ctrl+Shift+R (Windows) o Cmd+Shift+R (Mac)
3. Intenta en incógnito (Ctrl+Shift+N)

### "No aparece en https://franciscombp.github.io/"

Eso es normal. GitHub Pages **no lista** los repos públicamente. Solo funciona:
- https://franciscombp.github.io/quanto/ ✅
- https://franciscombp.github.io/ (si tienes un repo llamado `franciscombp.github.io`)

### "Source sigue diciendo 'None'"

Posible que no hayas hecho click en Save. Intenta:
1. Recarga la página (F5)
2. Vuelve a Settings → Pages
3. Selecciona `main` de nuevo
4. Click Save

---

## Después: tu flujo de desarrollo

```bash
# 1. Haz cambios
vim assets/app.js

# 2. Test local
# python3 -m http.server 8000
# Abre http://localhost:8000/

# 3. Commit y push
git add -A
git commit -m "Agregar botón X"
git push origin main

# 4. GitHub Pages actualiza automáticamente (~1 min)
# Visita https://franciscombp.github.io/quanto/
# Verás tu cambio en vivo ✨
```

---

## Preguntas frecuentes

**¿Puedo usar una rama diferente?**
Sí, pero nosotros recomendamos `main` para simplicidad. Solo cambia en Settings → Pages.

**¿Se actualiza instantáneamente?**
No, tarda 30-60 segundos. Eso es normal.

**¿Puedo desplegar desde un folder específico (no root)?**
Sí, en Settings → Pages → Folder, elige `/docs`. Pero nuestro proyecto está en root.

**¿Necesito hacer algo cada vez que pusheo?**
No. Cada `git push origin main` se publica automáticamente.

**¿Cómo reviertp un deploy?**
```bash
git revert HEAD  # Crea un commit que deshace los cambios
git push origin main  # Se publica la versión anterior
```

---

**Eso es. Ya estás en producción.** 🎉
