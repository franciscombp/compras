import Foundation
import Vision
import CoreGraphics
import CoreImage

/// OCR y código de barras con Vision, en el dispositivo.
/// Como el escáner de documentos: si encuentra el rectángulo de la etiqueta,
/// lo endereza y lee solo lo de adentro; si no, lee la imagen entera.
/// Devuelve el texto por líneas y cada palabra con su caja en píxeles, con
/// la misma forma que las palabras de Tesseract: web/assets/ocr.js usa el alto
/// de cada palabra para saber cuál es el precio (el número más grande).
enum LectorEtiqueta {

    struct Lectura {
        var texto: String
        var lineas: [[String: Any]]
        var palabras: [[String: Any]]
        var codigo: String?
        /// Esquinas del marco usado (normalizadas, origen arriba-izquierda), o nil si se leyó la imagen entera.
        var marco: [CGPoint]?
    }

    private static let contextoCI = CIContext(options: [.useSoftwareRenderer: false])

    /// `rapido` usa el nivel .fast de Vision (precios grandes, varias veces más
    /// veloz). `marco` busca la etiqueta y lee solo dentro de ella.
    static func leer(_ imagen: CGImage, rapido: Bool = false, marco: Bool = true) throws -> Lectura {
        let rectReq = MarcoEtiqueta.peticion(maximo: 8)
        let barrasReq = VNDetectBarcodesRequest()
        // Pasada rápida de texto: solo para saber dónde están los números y
        // elegir el rectángulo que de verdad contiene el precio.
        let pistaReq = VNRecognizeTextRequest()
        pistaReq.recognitionLevel = .fast
        pistaReq.usesLanguageCorrection = false
        let handler = VNImageRequestHandler(cgImage: imagen, orientation: .up, options: [:])
        try handler.perform(marco ? [rectReq, barrasReq, pistaReq] : [barrasReq])

        // Código de barras: solo numéricos de 8 a 14 dígitos (EAN/UPC).
        let codigo = (barrasReq.results ?? [])
            .compactMap { $0.payloadStringValue }
            .first { $0.count >= 8 && $0.count <= 14 && $0.allSatisfy(\.isNumber) }

        let centrosConPrecio: [CGPoint] = (pistaReq.results ?? []).compactMap { obs in
            guard let t = obs.topCandidates(1).first?.string, t.range(of: #"\d[.,]?\s?\d{2}"#, options: .regularExpression) != nil else { return nil }
            return CGPoint(x: obs.boundingBox.midX, y: obs.boundingBox.midY)
        }
        if marco, let o = MarcoEtiqueta.etiqueta(rectReq.results ?? [], centrosConPrecio: centrosConPrecio) {
            let e = MarcoEtiqueta.esquinas(o)
            if let recto = MarcoEtiqueta.enderezar(CIImage(cgImage: imagen), esquinas: e),
               let cg = contextoCI.createCGImage(recto, from: recto.extent) {
                let r = try reconocer(cg, rapido: rapido)
                // Si dentro del marco no hay ningún número, el rectángulo no era
                // la etiqueta (una caja, un cartel): se lee la imagen entera.
                if r.texto.rangeOfCharacter(from: .decimalDigits) != nil {
                    return Lectura(texto: r.texto, lineas: r.lineas, palabras: r.palabras, codigo: codigo,
                                   marco: MarcoEtiqueta.esquinasPantalla(e))
                }
            }
        }
        let r = try reconocer(imagen, rapido: rapido)
        return Lectura(texto: r.texto, lineas: r.lineas, palabras: r.palabras, codigo: codigo, marco: nil)
    }

    /// Texto de una imagen: líneas de arriba hacia abajo y palabras con su caja en píxeles.
    static func reconocer(_ imagen: CGImage, rapido: Bool) throws -> (texto: String, lineas: [[String: Any]], palabras: [[String: Any]]) {
        let ancho = CGFloat(imagen.width), alto = CGFloat(imagen.height)
        let textoReq = VNRecognizeTextRequest()
        textoReq.recognitionLevel = rapido ? .fast : .accurate
        textoReq.recognitionLanguages = ["es-ES", "en-US"]
        textoReq.usesLanguageCorrection = true
        try VNImageRequestHandler(cgImage: imagen, orientation: .up, options: [:]).perform([textoReq])

        func caja(_ r: CGRect) -> [String: Any] {
            ["x0": r.minX * ancho, "x1": r.maxX * ancho, "y0": (1 - r.maxY) * alto, "y1": (1 - r.minY) * alto]
        }

        var lineas: [String] = []
        var lineasConCaja: [[String: Any]] = []
        var palabras: [[String: Any]] = []
        // Vision entrega líneas; se ordenan de arriba hacia abajo y se parten
        // en palabras con su caja (origen de Vision abajo-izquierda, normalizado).
        for obs in (textoReq.results ?? []).sorted(by: { $0.boundingBox.maxY > $1.boundingBox.maxY }) {
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
        return (lineas.joined(separator: "\n"), lineasConCaja, palabras)
    }
}

/// La lectura se arma en un hilo de fondo y se entrega al principal sin tocarla.
extension LectorEtiqueta.Lectura: @unchecked Sendable {}
