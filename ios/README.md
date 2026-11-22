# Quanto para iPhone (SwiftUI)

App nativa en SwiftUI. La interfaz es 100 % nativa y la lógica es la misma
que usa la web, sin reescribirla:

| Pieza | Cómo |
|---|---|
| Pantallas | SwiftUI: `TabView` (Inicio, Comparar, Listas, Ahorro), `NavigationStack`, hojas, `Form`, `List` con gestos, búsqueda, Swift Charts |
| Cámara del estante | AVFoundation + Vision en cada fotograma, overlay en `Canvas` (`Camara/`) |
| Marco de la etiqueta | Vision (`VNDetectRectanglesRequest`) + Core Image: lee solo dentro de la etiqueta |
| Parser de etiquetas, datos, motor de ahorro | `web/assets/ocr.js`, `web/data/store.js` y `web/data/ahorro.js` corriendo en **JavaScriptCore** (`Nucleo/MotorJS.swift`) |
| Apple Intelligence | Foundation Models (iOS 26+): afina etiquetas, entiende frases al agregar, explica comparaciones, coach semanal |
| Recordatorios | EventKit: enviar la lista y traer pendientes |
| Siri y Atajos | App Intents: "Agrega a mi lista de Quanto", "Escanea precios con Quanto", "¿Cuánto llevo en Quanto?" |
| Compartir | `ShareLink` (Notas, Mensajes, WhatsApp) |

Nada sale del teléfono salvo la consulta opcional a Open Food Facts por
código de barras.

## Compilar

Necesitas un Mac con Xcode 16 o superior (Xcode 26 para Apple Intelligence)
y [XcodeGen](https://github.com/yonaskolb/XcodeGen):

```bash
brew install xcodegen
npm run ios          # genera logica.js, el proyecto y abre Xcode
```

En Xcode: target **Quanto** → *Signing & Capabilities* → elige tu equipo
(tu Apple ID sirve para probar en tu iPhone). Conecta el iPhone y ▶︎.

`Quanto.xcodeproj` e `Info.plist` no se versionan: salen de `project.yml`.
Si agregas un archivo Swift, vuelve a correr `npm run ios` (o `cd ios && xcodegen`).

## Cómo está armada

```
ios/
├── project.yml              Proyecto de XcodeGen (iOS 17+, iPhone, app.quanto.compras)
└── Quanto/
    ├── App/                 QuantoApp (@main), RaizView (pestañas), Navegacion
    ├── Nucleo/
    │   ├── MotorJS.swift    JSContext con logica.js; localStorage en memoria volcado a datos.json
    │   ├── Datos.swift      Fachada @Observable: listas, items, memoria de precios, ahorro, copias
    │   ├── Modelos.swift    Tipos Codable de lo que devuelve la lógica JS
    │   ├── Migracion.swift  Trae los datos de la versión anterior (web en Capacitor)
    │   ├── Catalogo.swift   Catálogo local (web/data/catalogo.json) y Open Food Facts
    │   └── Formato.swift    Precios, medidas, unidades
    ├── Camara/              BarridoModelo/View (cámara), EtiquetasVivo, MarcoEtiqueta, LectorEtiqueta
    ├── Servicios/           AppleIA (Foundation Models), Recordatorios (EventKit)
    ├── Vistas/              Inicio, Comparar (+Comparador), Escáner, Listas, items, Ahorro, Ajustes
    ├── Atajos/              App Intents para Siri y Atajos
    └── Recursos/            logica.js (GENERADO), Assets.xcassets
```

### Una sola lógica para web e iPhone

`scripts/logica-ios.mjs` junta `ocr.js`, `store.js` y `ahorro.js` en
`Recursos/logica.js` (JavaScriptCore no carga módulos ES). Swift solo llama a
`QuantoLlamar(nombre, argsJSON)` y decodifica la respuesta:

```swift
let totales = motor.valor(Totales.self, "calcularTotales", [listaId])
```

- Si cambias la lógica de la web, corre `npm run logica:ios` (o `npm run ios`).
  `npm test` falla si `logica.js` quedó desactualizado.
- `tests/logica-ios-test.mjs` ejecuta el archivo en un contexto vacío (sin
  DOM, como JavaScriptCore) y prueba listas, parser, semáforo y migración.
- Los datos se guardan en `Application Support/Quanto/datos.json` con las
  mismas claves que la web (`justo:*`). La copia de seguridad es el mismo
  JSON que exporta la web: sirve para pasar datos entre las dos.

### Datos de la versión anterior

La app conserva el identificador `app.quanto.compras`, así que instalada
encima de la versión con Capacitor encuentra su `localStorage`. Al primer
arranque, `MigracionWeb` abre un WebView invisible en `capacitor://localhost`,
lee las claves `justo:*` y las fusiona por id. Ajustes → *Traer datos de la
versión anterior* lo repite. Si usabas la web en Safari, exporta la copia en
la web (Ajustes → Copia de seguridad) e impórtala en Ajustes de la app.

## Flujo de la cámara

1. Comparar → *Escanear etiquetas del estante* (o Inicio, o Siri) abre
   `EscanerView` a pantalla completa.
2. `BarridoModelo` lee cada fotograma con Vision, busca el rectángulo de cada
   etiqueta y agrupa el texto (`EtiquetasVivo`); a la segunda vista la
   confirma, la endereza y la relee con precisión.
3. `EscanerSesion` la pasa por el parser de la web (`leerVision`), la agrega
   al comparador y pide a Apple Intelligence que afine nombre, contenido y pack
   (nunca el precio). Con código de barras, Open Food Facts completa.
4. El overlay muestra el precio por 100 g de cada etiqueta y marca la mejor.
   Tocar una confirmada abre su ficha para corregirla.
5. *Ver comparación* cierra la cámara y muestra el ranking en Comparar, con la
   explicación ✦ de Apple Intelligence y el botón para agregar a la lista.

También se puede leer una etiqueta desde una foto de la galería (Comparar →
*Leer una etiqueta de una foto*).

## Probar sin iPhone

La lógica se prueba en Node (`npm test`). Listas, comparador y ahorro corren
en el simulador; la cámara, Vision y Apple Intelligence necesitan el iPhone.
