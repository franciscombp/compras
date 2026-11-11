import Foundation
import Vision
import CoreGraphics

/// OCR y código de barras con Vision, en el dispositivo.
/// Devuelve el texto por líneas y cada palabra con su caja en píxeles, con
/// la misma forma que las palabras de Tesseract: assets/ocr.js usa el alto
/// de cada palabra para saber cuál es el precio (el número más grande).
enum LectorEtiqueta {

    struct Lectura {
        var texto: String
        var lineas: [[String: Any]]
        var palabras: [[String: Any]]
        var codigo: String?
    }

    /// `rapido` usa el nivel .fast de Vision: menos preciso con letra pequeña
    /// pero suficiente para precios grandes y varias veces más veloz. Lo usa
    /// el barrido en vivo; la captura puntual usa .accurate.
    static func leer(_ imagen: CGImage, rapido: Bool = false) throws -> Lectura {
        let ancho = CGFloat(imagen.width), alto = CGFloat(imagen.height)

        let textoReq = VNRecognizeTextRequest()
        textoReq.recognitionLevel = rapido ? .fast : .accurate
        textoReq.recognitionLanguages = ["es-ES", "en-US"]
        textoReq.usesLanguageCorrection = true

        let barrasReq = VNDetectBarcodesRequest()

        let handler = VNImageRequestHandler(cgImage: imagen, orientation: .up, options: [:])
        try handler.perform([textoReq, barrasReq])

        var lineas: [String] = []
        var lineasConCaja: [[String: Any]] = []
        var palabras: [[String: Any]] = []
        let observaciones = textoReq.results ?? []

        func caja(_ r: CGRect) -> [String: Any] {
            ["x0": r.minX * ancho, "x1": r.maxX * ancho, "y0": (1 - r.maxY) * alto, "y1": (1 - r.minY) * alto]
        }

        // Vision entrega líneas; se ordenan de arriba hacia abajo y se parten
        // en palabras con su caja (origen de Vision abajo-izquierda, normalizado).
        for obs in observaciones.sorted(by: { $0.boundingBox.maxY > $1.boundingBox.maxY }) {
            guard let candidato = obs.topCandidates(1).first else { continue }
            let texto = candidato.string
            lineas.append(texto)
            lineasConCaja.append(["text": texto, "bbox": caja(obs.boundingBox)])
            var inicio = texto.startIndex
            for palabra in texto.split(separator: " ") {
                guard let rango = texto.range(of: String(palabra), range: inicio..<texto.endIndex) else { continue }
                inicio = rango.upperBound
                let rect = (try? candidato.boundingBox(for: rango))?.boundingBox ?? obs.boundingBox
                palabras.append(["text": String(palabra), "bbox": caja(rect)])
            }
        }

        // Código de barras: solo numéricos de 8 a 14 dígitos (EAN/UPC).
        let codigo = (barrasReq.results ?? [])
            .compactMap { $0.payloadStringValue }
            .first { $0.count >= 8 && $0.count <= 14 && $0.allSatisfy(\.isNumber) }

        return Lectura(texto: lineas.joined(separator: "\n"), lineas: lineasConCaja, palabras: palabras, codigo: codigo)
    }
}
