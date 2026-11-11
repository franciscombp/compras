# Quanto nativo (Capacitor + Vision + Apple Intelligence)

La misma web de Quanto empaquetada como app iOS. Lo único nativo es un
plugin pequeño (`ios/App/App/VisionLectorPlugin.swift`) que lee la etiqueta
con **Vision** (OCR de Apple, en el dispositivo, gratis) y, si el iPhone lo
soporta, interpreta el texto con **Apple Intelligence** (framework Foundation
Models, iOS 26+). Si no, usa el parser de `assets/ocr.js` sobre el texto de
Vision. Nada sale del teléfono y no cuesta nada por lectura.

Orden de lectores en la app (`leerDatosEtiqueta` en `assets/app.js`):
nativo → lector IA remoto (`worker/`, si está configurado) → Tesseract.

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

En la pantalla *Comparar con cámara* el botón bajo la cámara dice
`Lector: Vision nativo ✦` y, tras cada captura, el estado indica
`Capturada (Apple Intelligence)` o `Capturada (Vision)`.

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
        ├── VisionLectorPlugin.swift   # OCR con Vision + cajas por palabra
        ├── EtiquetaIA.swift           # Foundation Models (iOS 26+), con fallback
        ├── Info.plist                 # NSCameraUsageDescription
        └── Base.lproj/Main.storyboard # usa MainViewController
```

## Notas

- El código Swift se escribió sin compilarlo (no hay Xcode en el entorno
  donde se generó). Si Xcode marca algo, lo más probable es un detalle de la
  API de Foundation Models (`@Generable`, `@Guide`); Vision es API estable.
- El Service Worker se omite dentro de la app: WKWebView no lo soporta en el
  esquema `capacitor://` y no hace falta (la web va dentro del paquete).
- Para pasar a producción: cambiar icono y splash en `Assets.xcassets`,
  ajustar `appId`, y distribuir por TestFlight o App Store.
