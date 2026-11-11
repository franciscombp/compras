# Quanto nativo (Capacitor + Vision + Apple Intelligence)

La misma web de Quanto empaquetada como app iOS. Lo nativo es un plugin
(`QuantoNativo`) que pone el iPhone al servicio de la app:

| Capacidad | Framework | Dónde se usa |
|---|---|---|
| **Barrido en vivo con cámara nativa**: SwiftUI + AVFoundation; Vision lee cada fotograma sin pasar por el WebView, overlay a 60 fps, linterna, enfoque por toque | `BarridoView`, `BarridoModelo`, `EtiquetasVivo` | Comparar con cámara, modo por defecto |
| OCR de etiquetas con cajas por palabra y por línea | Vision | Comparar con cámara |
| Código de barras (EAN/UPC) | Vision | Completa nombre y contenido desde Open Food Facts o el catálogo |
| Interpretar la etiqueta (precio, contenido, pack, nombre) | Apple Intelligence (Foundation Models, iOS 26+) | Comparar con cámara |
| Interpretar una frase dictada o escrita ("dos leches Vita de litro a 1.25") | Apple Intelligence | Agregar item a la lista |
| Explicar el veredicto en lenguaje natural | Apple Intelligence | Comparador manual y cámara |
| Coach de ahorro: redacta el consejo de la semana con tus números reales | Apple Intelligence | Pantalla Ahorro |
| Vibración al capturar, pantalla encendida en la góndola | UIKit | Comparar con cámara |
| Enviar la lista a Recordatorios y traer pendientes de allí | EventKit | Listas → ⋯ |
| Compartir la lista a Notas, Mensajes, WhatsApp… | UIActivityViewController | Listas → ⋯ |

Si Apple Intelligence no está disponible, cada función cae a la lógica local
(parser de `assets/ocr.js`, textos fijos). Nada sale del teléfono y no cuesta
nada por lectura. El dictado usa el micrófono del teclado de iOS, así que no
hace falta permiso de micrófono.

Orden de lectores en la app (`leerDatosEtiqueta` en `assets/app.js`):
nativo → lector IA remoto (`worker/`, si está configurado) → Tesseract.

## Barrido en vivo (cómo funciona)

La cámara es nativa; el cerebro sigue en la web.

1. `abrirBarrido` presenta `BarridoView` (SwiftUI) a pantalla completa.
   `BarridoModelo` arma la `AVCaptureSession` (1080p, buffers ya en
   vertical) y pasa cada fotograma a Vision (`.accurate`; baja a `.fast` si
   tarda más de 1,2 s dos veces).
2. `EtiquetasVivo.swift` (puerto de `assets/vivo.js`) agrupa las líneas por
   cercanía en etiquetas, parte los grupos con dos precios separados
   (etiquetas pegadas en el riel) y `SeguimientoVivo` las empareja con el
   fotograma anterior (posición y, si la cámara saltó, firma). A la segunda
   vista se confirma y se entrega una sola vez.
3. Cada etiqueta confirmada llega a la web como evento `barridoEtiqueta`
   (texto, palabras con caja, miniatura recortada). La web la parsea con
   `parseEtiqueta`, la mete en la bandeja, pide a Apple Intelligence que
   la refine (`interpretarEtiqueta`) y devuelve al overlay el precio por
   100 g y el ganador (`actualizarEtiquetas`).
4. El overlay (Canvas de SwiftUI) dibuja cada etiqueta con su chip; el
   ganador en verde con ★. Tocar una etiqueta sin confirmar la agrega al
   instante; tocar una confirmada cierra la cámara y abre su ficha en la
   web. Hay pausa, linterna y enfoque por toque.
5. Al cerrar (`Listo`), la bandeja, el veredicto, la explicación ✦ y el
   carrito son los de siempre.

El barrido en el WebView (`cicloBarrido` en `app.js`) sigue existiendo como
alternativa cuando el plugin no ofrece `barridoNativo` (Android, pruebas).
Pruebas de la lógica sin dispositivo: `node lab/vivo-test.mjs` (la versión
Swift es un puerto línea a línea; conviene añadirle XCTest en el Mac).

## Recordatorios y Notas

- **Recordatorios** tiene API pública (EventKit): "Enviar a Recordatorios"
  crea una lista con el nombre de tu lista de Quanto y un recordatorio por
  item (nota con cantidad, gramaje y precio estimado), sin duplicar los que
  ya estén pendientes. "Traer pendientes de Recordatorios" lee esa lista o,
  si está vacía, todas, y te deja elegir cuáles agregar. La primera vez iOS
  pide permiso.
- **Notas** no tiene API: "Compartir lista" abre la hoja de compartir de iOS
  y ahí eliges Notas, Mensajes o WhatsApp. En web usa `navigator.share` o
  copia al portapapeles.

## Portar a web y Android

Toda la web habla con el dispositivo a través de `data/nativo.js`, que expone
`capacidades`, `leerEtiquetaNativa`, `interpretarEtiqueta`,
`interpretarProducto`, `explicarComparacion`, `redactarConsejo`, `haptico`,
`mantenerPantalla`, `exportarRecordatorios`, `importarRecordatorios` y `compartir`. En web esas funciones
devuelven `null`/`false` y la app usa sus alternativas. Para Android basta con
un plugin de Capacitor con el mismo nombre (`QuantoNativo`) y los mismos
métodos, por ejemplo con ML Kit (texto y códigos de barras) y Gemini Nano o el
Worker de `worker/` para interpretar.

## Requisitos en el Mac

- Xcode 16 o superior (para iOS 26 y Foundation Models, Xcode 26). El
  target compila para iOS 17 o superior.
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
        ├── Recordatorios.swift        # EventKit: exportar e importar la lista de compras
        ├── BarridoView.swift          # SwiftUI: cámara a pantalla completa, overlay, controles
        ├── BarridoModelo.swift        # AVCaptureSession + Vision por fotograma + entrega a la web
        ├── EtiquetasVivo.swift        # Puerto de assets/vivo.js: agrupar etiquetas y seguimiento
        ├── Info.plist                 # permisos de cámara y Recordatorios
        └── Base.lproj/Main.storyboard # usa MainViewController
```

## Notas

- El código Swift se escribió sin compilarlo (no hay Xcode en el entorno
  donde se generó). Si Xcode marca algo, lo más probable es un detalle de la
  API de Foundation Models en `AppleIA.swift` (`@Generable`, `@Guide`,
  `prewarm()`); Vision y Capacitor son API estable.
- La web se probó en Chromium simulando el plugin: barrido en vivo (dos
  etiquetas confirmadas, overlay, toque, pausa, cambio de modo), lectura con
  código de barras y con Apple Intelligence, explicación del veredicto,
  asistente con frase interpretada, Recordatorios (enviar y traer), compartir,
  hápticos y pantalla activa.
- En el iPhone conviene ajustar dos números según lo que veas en la góndola:
  `confirmarTras` (vistas para confirmar, 2) y los factores `expH`/`expV` de
  `agruparEtiquetas` si etiquetas vecinas se juntan o una se parte.
- El Service Worker se omite dentro de la app: WKWebView no lo soporta en el
  esquema `capacitor://` y no hace falta (la web va dentro del paquete).
- Para pasar a producción: cambiar icono y splash en `Assets.xcassets`,
  ajustar `appId`, y distribuir por TestFlight o App Store.
