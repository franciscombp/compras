import Foundation
import Capacitor
import Vision
import UIKit

/// Lector de etiquetas nativo.
///
/// `leer({ imagen: <JPEG base64>, ia: Bool })` devuelve:
///   - texto:    todas las líneas que vio Vision, separadas por "\n"
///   - palabras: [{ text, bbox: { x0, y0, x1, y1 } }] en píxeles, misma forma
///               que las palabras de Tesseract (assets/ocr.js las usa para
///               detectar el precio como "el número más grande")
///   - ia:       interpretación de Apple Intelligence (Foundation Models) o
///               null si el dispositivo no la soporta o `ia` es false
///   - iaEstado: "ok" | "desactivada" | "no_disponible" | "error"
///
/// `capacidades()` devuelve { vision: true, appleIntelligence: Bool }.
@objc(VisionLectorPlugin)
public class VisionLectorPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "VisionLectorPlugin"
    public let jsName = "VisionLector"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "leer", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "capacidades", returnType: CAPPluginReturnPromise),
    ]

    @objc func capacidades(_ call: CAPPluginCall) {
        call.resolve([
            "vision": true,
            "appleIntelligence": EtiquetaIA.disponible(),
        ])
    }

    @objc func leer(_ call: CAPPluginCall) {
        guard let base64 = call.getString("imagen"),
              let data = Data(base64Encoded: base64, options: .ignoreUnknownCharacters),
              let imagen = UIImage(data: data),
              let cg = imagen.cgImage else {
            call.reject("imagen_invalida")
            return
        }
        let usarIA = call.getBool("ia") ?? true
        let ancho = CGFloat(cg.width), alto = CGFloat(cg.height)

        let request = VNRecognizeTextRequest { request, error in
            if let error = error {
                call.reject("vision: \(error.localizedDescription)")
                return
            }
            let observaciones = (request.results as? [VNRecognizedTextObservation]) ?? []
            var lineas: [String] = []
            var palabras: [[String: Any]] = []

            // Vision devuelve líneas (de arriba hacia abajo). Se parten en
            // palabras con su caja para que el parser sepa cuál texto es el
            // más grande de la etiqueta: en góndola, ese es el precio.
            for obs in observaciones.sorted(by: { $0.boundingBox.maxY > $1.boundingBox.maxY }) {
                guard let candidato = obs.topCandidates(1).first else { continue }
                let texto = candidato.string
                lineas.append(texto)
                var inicio = texto.startIndex
                for palabra in texto.split(separator: " ") {
                    guard let rango = texto.range(of: String(palabra), range: inicio..<texto.endIndex) else { continue }
                    inicio = rango.upperBound
                    let caja = (try? candidato.boundingBox(for: rango))?.boundingBox ?? obs.boundingBox
                    palabras.append([
                        "text": String(palabra),
                        "bbox": [
                            "x0": caja.minX * ancho,
                            "x1": caja.maxX * ancho,
                            "y0": (1 - caja.maxY) * alto,
                            "y1": (1 - caja.minY) * alto,
                        ],
                    ])
                }
            }
            let texto = lineas.joined(separator: "\n")

            var resultado: [String: Any] = [
                "texto": texto,
                "palabras": palabras,
                "motor": "vision",
                "ia": NSNull(),
                "iaEstado": usarIA ? "no_disponible" : "desactivada",
            ]

            guard usarIA, !texto.isEmpty, EtiquetaIA.disponible() else {
                call.resolve(resultado)
                return
            }
            Task {
                do {
                    if let ia = try await EtiquetaIA.interpretar(texto: texto) {
                        resultado["ia"] = ia
                        resultado["iaEstado"] = "ok"
                    }
                } catch {
                    resultado["iaEstado"] = "error: \(error.localizedDescription)"
                }
                call.resolve(resultado)
            }
        }
        request.recognitionLevel = .accurate
        request.recognitionLanguages = ["es-ES", "en-US"]
        request.usesLanguageCorrection = true

        DispatchQueue.global(qos: .userInitiated).async {
            let handler = VNImageRequestHandler(cgImage: cg, orientation: .up, options: [:])
            do {
                try handler.perform([request])
            } catch {
                call.reject("vision: \(error.localizedDescription)")
            }
        }
    }
}
