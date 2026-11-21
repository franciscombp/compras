import Foundation
import Vision
import CoreImage
import CoreGraphics

/// Rectángulos de etiqueta con Vision, al estilo del escáner de documentos:
/// encuentra el borde de cada etiqueta de góndola, sabe qué texto cae dentro
/// y puede devolver la etiqueta enderezada (perspectiva corregida) para leer
/// solo eso. Las esquinas viajan en coordenadas normalizadas de Vision
/// (origen abajo-izquierda) en el orden tl, tr, br, bl.
enum MarcoEtiqueta {

    /// Petición ajustada a etiquetas de precio: pequeñas, más anchas que altas
    /// (o casi cuadradas), a veces algo torcidas.
    static func peticion(maximo: Int = 8) -> VNDetectRectanglesRequest {
        let r = VNDetectRectanglesRequest()
        r.minimumAspectRatio = 0.2       // lado corto / lado largo
        r.maximumAspectRatio = 1.0
        r.minimumSize = 0.08             // fracción de la dimensión menor de la imagen
        r.quadratureTolerance = 25       // grados de desvío permitidos en las esquinas
        r.minimumConfidence = 0.55
        r.maximumObservations = maximo
        return r
    }

    static func esquinas(_ o: VNRectangleObservation) -> [CGPoint] {
        [o.topLeft, o.topRight, o.bottomRight, o.bottomLeft]
    }

    /// Esquinas con origen arriba-izquierda, para dibujar en pantalla.
    static func esquinasPantalla(_ e: [CGPoint]) -> [CGPoint] {
        e.map { CGPoint(x: $0.x, y: 1 - $0.y) }
    }

    /// ¿El punto (normalizado, origen abajo-izquierda) cae dentro del cuadrilátero convexo?
    static func contiene(_ e: [CGPoint], _ p: CGPoint) -> Bool {
        guard e.count == 4 else { return false }
        var signo: CGFloat = 0
        for i in 0..<4 {
            let a = e[i], b = e[(i + 1) % 4]
            let cruz = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
            if abs(cruz) < 1e-9 { continue }
            let s: CGFloat = cruz > 0 ? 1 : -1
            if signo == 0 { signo = s } else if s != signo { return false }
        }
        return true
    }

    static func area(_ e: [CGPoint]) -> CGFloat {
        guard e.count == 4 else { return 0 }
        var a: CGFloat = 0
        for i in 0..<4 { let p = e[i], q = e[(i + 1) % 4]; a += p.x * q.y - q.x * p.y }
        return abs(a) / 2
    }

    static func caja(_ e: [CGPoint]) -> CGRect {
        let xs = e.map(\.x), ys = e.map(\.y)
        return CGRect(x: xs.min() ?? 0, y: ys.min() ?? 0, width: (xs.max() ?? 0) - (xs.min() ?? 0), height: (ys.max() ?? 0) - (ys.min() ?? 0))
    }

    /// La etiqueta enderezada, con un pequeño margen alrededor del borde.
    static func enderezar(_ ci: CIImage, esquinas e: [CGPoint], margen: CGFloat = 0.04) -> CIImage? {
        guard e.count == 4, let f = CIFilter(name: "CIPerspectiveCorrection") else { return nil }
        let ext = ci.extent
        let cx = e.map(\.x).reduce(0, +) / 4, cy = e.map(\.y).reduce(0, +) / 4
        func vector(_ p: CGPoint) -> CIVector {
            let x = min(1, max(0, cx + (p.x - cx) * (1 + margen * 2)))
            let y = min(1, max(0, cy + (p.y - cy) * (1 + margen * 2)))
            return CIVector(x: ext.minX + x * ext.width, y: ext.minY + y * ext.height)
        }
        f.setValue(ci, forKey: kCIInputImageKey)
        f.setValue(vector(e[0]), forKey: "inputTopLeft")
        f.setValue(vector(e[1]), forKey: "inputTopRight")
        f.setValue(vector(e[2]), forKey: "inputBottomRight")
        f.setValue(vector(e[3]), forKey: "inputBottomLeft")
        return f.outputImage
    }

    /// Elige la etiqueta principal de una foto: la más grande y centrada.
    static func principal(_ obs: [VNRectangleObservation], areaMin: CGFloat = 0.04) -> VNRectangleObservation? {
        obs.map { o -> (VNRectangleObservation, CGFloat) in
            let e = esquinas(o)
            let a = area(e)
            let c = caja(e)
            let dist = hypot(c.midX - 0.5, c.midY - 0.5) / 0.7071
            return (o, a < areaMin ? -1 : sqrt(a) * (1 - 0.6 * dist) * CGFloat(o.confidence))
        }
        .filter { $0.1 > 0 }
        .max { $0.1 < $1.1 }?.0
    }
}
