# 🌿 Guía de Branches

## Convención de nombres

```
<tipo>/<descripción-corta>

Ejemplos:
  feature/wizard-agregar-items
  fix/ocr-precio-unitario
  design/mejor-comparador
  docs/setup-pwa
```

**Tipos:**
- `feature/` — característica nueva
- `fix/` — corrección de bug
- `design/` — cambios visuales / UX
- `refactor/` — limpieza de código sin cambios de funcionalidad
- `docs/` — documentación
- `test/` — tests o mejoras de testabilidad

## Flujo

### 1. Crear una branch de desarrollo

```bash
git fetch origin
git checkout -b feature/mi-caracteristica
```

### 2. Hacer commits pequeños y claros

```bash
# Bien:
git commit -m "Agregar inputs hero al wizard de items

- Diseño tipo Airbnb con progresión visual
- Uno o dos campos por pantalla
- Validación en tiempo real"

# Evitar:
git commit -m "Update" # ❌ Vacío
git commit -m "Fix stuff" # ❌ Vago
```

### 3. Push y abrir PR

```bash
git push -u origin feature/mi-caracteristica
```

Abre un PR en GitHub / plataforma de git y:
- Completa el template
- Describe cambios visuales con screenshots
- Menciona testing manual realizado

### 4. Review y merge

- Al menos 1 approval antes de mergear
- Squash commits si hay muchos (mantiene histórico limpio)
- Delete branch después de mergear

## Ramas protegidas

**`main`** — rama de producción
- Solo merge desde PRs aprobados
- Requiere tests y review
- Cada merge puede disparar GitHub Actions (deploy a gh-pages)

**`develop`** — rama de integración (opcional, si quieres staging)
- Merge frecuentes de features
- Menos restrictiva que `main`

## Comandos útiles

```bash
# Ver branches locales y remotas
git branch -a

# Cambiar a una rama existente
git checkout feature/x
git checkout -b feature/x origin/feature/x

# Borrar rama local
git branch -d feature/x

# Borrar rama remota
git push origin --delete feature/x

# Rebasing limpio antes de PR (mantiene histórico lineal)
git rebase main
git push --force-with-lease

# Ver qué cambios hay en mi branch vs main
git diff main..HEAD

# Listar branches ordenadas por fecha
git branch -v --sort=-committerdate
```

## Tips

✅ **Haz**: ramas cortas y enfocadas (1-2 días de trabajo max)
❌ **No hagas**: branches de larga vida con muchos cambios sin review

✅ **Haz**: commits tempranos, push frecuentes (no pierdas trabajo)
❌ **No hagas**: un solo commit gigante con 50 archivos

✅ **Haz**: describe en el PR qué probaste (cámara, offline, mobile)
❌ **No hagas**: "Listooo" sin contexto
