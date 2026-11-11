# Quanto nativo (Capacitor + Vision + Apple Intelligence)

La misma web de Quanto empaquetada como app iOS. Lo nativo es un plugin
(`QuantoNativo`) que pone el iPhone al servicio de la app:

| Capacidad | Framework | Dónde se usa |
|---|---|---|
| OCR de etiquetas con cajas por palabra | Vision | Comparar con cámara |
| Código de barras (EAN/UPC) | Vision | Completa nombre y contenido desde Open Food Facts o el catálogo |
| Interpretar la etiqueta (precio, contenido, pack, nombre) | Apple Intelligence (Foundation Models, iOS 26+) | Comparar con cámara |
| Interpretar una frase dictada o escrita ("dos leches Vita de litro a 1.25") | Apple Intelligence | Agregar item a la lista |
| Explicar el veredicto en lenguaje natural | Apple Intelligence | Comparador manual y cámara |
| Vibración al capturar, pantalla encendida en la góndola | UIKit | Comparar con cámara |

Si Apple Intelligence no está disponible, cada función cae a la lógica local
(parser de `assets/ocr.js`, textos fijos). Nada sale del teléfono y no cuesta
nada por lectura. El dictado usa el micrófono del teclado de iOS, así que no
hace falta permiso de micrófono.

Orden de lectores en la app (`leerDatosEtiqueta` en `assets/app.js`):
nativo → lector IA remoto (`worker/`, si está configurado) → Tesseract.

## Portar a web y Android

Toda la web habla con el dispositivo a través de `data/nativo.js`, que expone
`capacidades`, `leerEtiquetaNativa`, `interpretarProducto`,
`explicarComparacion`, `haptico` y `mantenerPantalla`. En web esas funciones
devuelven `null`/`false` y la app usa sus alternativas. Para Android basta con
un plugin de Capacitor con el mismo nombre (`QuantoNativo`) y los mismos
métodos, por ejemplo con ML Kit (texto y códigos de barras) y Gemini Nano o el
Worker de `worker/` para interpretar.

## Requisitos en el Mac

- Xcode 16 o superior (para iOS 26 y Foundation Models, Xcode 26).
- Node 22+.
- Un iPhone con iOS 15+ para Vision. Para Apple Intelligence: iPhone 15 Pro o
  posterior con iOS 26 y Apple Intelligence activado en Ajustes.
- Cuenta de Apple (la gratuita sirve para instalar en tu propio iPhone).

## Compilar e instalar

```bash
cd native
npm install
npm run ios        # copia la web a dist/, sincroniza y abre Xcode
```

En Xcode:

1. Selecciona el target **App** → pestaña *Signing & Capabilities* → marca
   *Automatically manage signing* y elige tu *Team*. Si el bundle id
   `app.quanto.compras` choca, cámbialo por el que quieras.
2. Conecta el iPhone, elígelo como destino y pulsa ▶.
3. La primera vez, en el iPhone: Ajustes → General → VPN y gestión de
   dispositivos → confía en tu certificado de desarrollador.

Cada vez que cambies la web (`index.html`, `assets/`, `data/`), repite
`npm run sync` (o `npm run ios`) y vuelve a ejecutar desde Xcode.

## Cómo saber qué lector se usó

En la pantalla *Comparar con cámara* el texto bajo la cámara dice
`Lector: Vision nativo ✦` y, tras cada captura, el estado indica
`Capturada (Apple Intelligence)` o `Capturada (Vision)`. Las notas que
empiezan con ✦ las escribió Apple Intelligence.

## Estructura

```
native/
├── capacitor.config.json     # appId, appName, webDir = dist
├── scripts/build-web.mjs     # copia la PWA a dist/ sin el Service Worker
├── dist/                     # generado (gitignored)
└── ios/App/
    ├── App.xcodeproj
    ├── CapApp-SPM/           # dependencias de Capacitor vía Swift Package Manager
    └── App/
        ├── MainViewController.swift   # registra el plugin en el puente de Capacitor
        ├── QuantoNativoPlugin.swift   # métodos expuestos a la web (window.Capacitor.Plugins.QuantoNativo)
        ├── LectorEtiqueta.swift       # Vision: OCR con cajas por palabra + código de barras
        ├── AppleIA.swift              # Foundation Models: etiqueta, producto dictado, veredicto
        ├── Info.plist                 # NSCameraUsageDescription
        └── Base.lproj/Main.storyboard # usa MainViewController
```

## Notas

- El código Swift se escribió sin compilarlo (no hay Xcode en el entorno
  donde se generó). Si Xcode marca algo, lo más probable es un detalle de la
  API de Foundation Models en `AppleIA.swift` (`@Generable`, `@Guide`,
  `prewarm()`); Vision y Capacitor son API estable.
- La web se probó en Chromium simulando el plugin: lectura con código de
  barras, lectura con Apple Intelligence, explicación del veredicto, asistente
  con frase interpretada, hápticos y pantalla activa.
- El Service Worker se omite dentro de la app: WKWebView no lo soporta en el
  esquema `capacitor://` y no hace falta (la web va dentro del paquete).
- Para pasar a producción: cambiar icono y splash en `Assets.xcassets`,
  ajustar `appId`, y distribuir por TestFlight o App Store.
