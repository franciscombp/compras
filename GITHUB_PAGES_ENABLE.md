# ⚙️ Habilitar GitHub Pages — Paso a paso

## El problema

Tu workflow de GitHub Actions está listo pero **GitHub Pages no está habilitado** en tu repositorio.

Sin esta configuración, el workflow no puede deployar aunque intente.

## La solución (3 pasos)

### 1️⃣ Ve a Settings de tu repositorio

```
https://github.com/franciscombp/quanto/settings
```

### 2️⃣ En el menú izquierdo, busca "Pages"

Debajo de "Code and automation" vas a ver:
- Branches
- **Pages** ← Click aquí

### 3️⃣ Configura el source

Vas a ver una sección **"Build and deployment"**:

```
Source: Deploy from a branch ← Selecciona esto
Branch: main ← Selecciona main
Folder: / (root) ← Selecciona root
```

Luego **click en "Save"**

## ✅ ¿Qué pasa después?

- GitHub detecta que Pages está habilitado
- El workflow automáticamente se ejecuta
- En 30-60 segundos tu app está en vivo
- La URL es: https://franciscombp.github.io/quanto/

## 🔍 Verificar que funcionó

1. Ve a Settings → Pages (arriba)
2. Deberías ver un mensaje verde: ✅ "Your site is live at https://franciscombp.github.io/quanto/"
3. Abre esa URL en tu navegador
4. Verás Quanto funcionando

## 📋 Checklist

- [ ] Fui a Settings → Pages
- [ ] Seleccioné "Deploy from a branch"
- [ ] Seleccioné rama "main" y folder "/"
- [ ] Hice click en "Save"
- [ ] Esperé 1 minuto
- [ ] Visité https://franciscombp.github.io/quanto/
- [ ] Veo la app funcionando ✅

---

**Una vez que hagas esto, GitHub automáticamente deployará cada vez que hagas `git push origin main`**
