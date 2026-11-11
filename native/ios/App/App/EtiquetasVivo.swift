import Foundation
import CoreGraphics

/// Lógica pura del barrido en vivo, portada de assets/vivo.js: agrupa las
/// líneas que Vision ve en un fotograma en etiquetas de precio y las sigue
/// entre fotogramas para que cada etiqueta se entregue una sola vez.
/// Trabaja en coordenadas normalizadas (0-1, origen arriba-izquierda), así
/// no depende de la resolución del sensor ni del tamaño de la pantalla.

struct Caja: Equatable {
    var x0: Double, y0: Double, x1: Double, y1: Double

    var ancho: Double { x1 - x0 }
    var alto: Double { y1 - y0 }
    var cx: Double { (x0 + x1) / 2 }
    var cy: Double { (y0 + y1) / 2 }

    /// Desde un rect de Vision (normalizado, origen abajo-izquierda).
    init(vision r: CGRect) {
        x0 = r.minX; x1 = r.maxX
        y0 = 1 - r.maxY; y1 = 1 - r.minY
    }

    init(x0: Double, y0: Double, x1: Double, y1: Double) {
        self.x0 = x0; self.y0 = y0; self.x1 = x1; self.y1 = y1
    }

    func union(_ b: Caja) -> Caja {
        Caja(x0: min(x0, b.x0), y0: min(y0, b.y0), x1: max(x1, b.x1), y1: max(y1, b.y1))
    }

    func cruza(_ b: Caja) -> Bool {
        x0 < b.x1 && b.x0 < x1 && y0 < b.y1 && b.y0 < y1
    }

    func iou(_ b: Caja) -> Double {
        let ix = max(0, min(x1, b.x1) - max(x0, b.x0))
        let iy = max(0, min(y1, b.y1) - max(y0, b.y0))
        let inter = ix * iy
        if inter <= 0 { return 0 }
        let area = ancho * alto + b.ancho * b.alto - inter
        return area > 0 ? inter / area : 0
    }

    func contiene(_ x: Double, _ y: Double) -> Bool {
        x >= x0 && x <= x1 && y >= y0 && y <= y1
    }

    func expandida(h: Double, v: Double) -> Caja {
        Caja(x0: x0 - alto * h, y0: y0 - alto * v, x1: x1 + alto * h, y1: y1 + alto * v)
    }

    func suavizada(hacia b: Caja, k: Double = 0.5) -> Caja {
        Caja(x0: x0 + (b.x0 - x0) * k, y0: y0 + (b.y0 - y0) * k, x1: x1 + (b.x1 - x1) * k, y1: y1 + (b.y1 - y1) * k)
    }
}

struct PalabraOCR {
    let text: String
    let caja: Caja
}

struct LineaOCR {
    let text: String
    let caja: Caja
    /// Rect original de Vision (origen abajo-izquierda) para recortar la miniatura.
    let visionRect: CGRect
    let palabras: [PalabraOCR]
}

struct Region {
    let caja: Caja
    let visionRect: CGRect
    let lineas: [LineaOCR]
    let texto: String
    let precio: Double
    var palabras: [PalabraOCR] { lineas.flatMap { $0.palabras } }
}

enum EtiquetasVivo {

    private static let rePrecio = try! NSRegularExpression(pattern: #"(?:^|\s)\$?\s?(\d{1,4}[.,]\d{2})(?!\d)"#)

    static func precios(en texto: String) -> [Double] {
        let ns = texto as NSString
        return rePrecio.matches(in: texto, range: NSRange(location: 0, length: ns.length)).compactMap { m in
            Double(ns.substring(with: m.range(at: 1)).replacingOccurrences(of: ",", with: "."))
        }.filter { $0 > 0 && $0 <= 5000 }
    }

    /// Agrupa líneas cercanas en etiquetas. Cada línea se expande en
    /// proporción a su alto y se unen las que se tocan; un grupo con dos
    /// precios separados en horizontal se parte (etiquetas pegadas en el riel).
    static func agrupar(_ lineas: [LineaOCR], expH: Double = 0.8, expV: Double = 0.9) -> [Region] {
        let ls = lineas.filter { !$0.text.trimmingCharacters(in: .whitespaces).isEmpty }
        if ls.isEmpty { return [] }
        let exp = ls.map { $0.caja.expandida(h: expH, v: expV) }
        var padre = Array(0..<ls.count)
        func raiz(_ i: Int) -> Int {
            var i = i
            while padre[i] != i { padre[i] = padre[padre[i]]; i = padre[i] }
            return i
        }
        for i in 0..<ls.count {
            for j in (i + 1)..<ls.count where exp[i].cruza(exp[j]) {
                padre[raiz(i)] = raiz(j)
            }
        }
        var grupos: [Int: [LineaOCR]] = [:]
        for (i, l) in ls.enumerated() { grupos[raiz(i), default: []].append(l) }

        var regiones: [Region] = []
        for grupo in grupos.values {
            for sub in dividirPorPrecios(grupo) {
                if let r = construir(sub) { regiones.append(r) }
            }
        }
        return regiones.sorted { $0.caja.x0 < $1.caja.x0 }
    }

    private static func dividirPorPrecios(_ grupo: [LineaOCR]) -> [[LineaOCR]] {
        let conPrecio = grupo.filter { !precios(en: $0.text).isEmpty }.sorted { $0.caja.x0 < $1.caja.x0 }
        if conPrecio.count < 2 { return [grupo] }
        var anclas: [LineaOCR] = []
        for p in conPrecio {
            let solapa = anclas.contains { a in p.caja.x0 < a.caja.x1 && a.caja.x0 < p.caja.x1 }
            if !solapa { anclas.append(p) }
        }
        if anclas.count < 2 { return [grupo] }
        var subs = Array(repeating: [LineaOCR](), count: anclas.count)
        for l in grupo {
            var mejor = 0, dist = Double.infinity
            for (i, a) in anclas.enumerated() {
                let d = abs(a.caja.cx - l.caja.cx)
                if d < dist { dist = d; mejor = i }
            }
            subs[mejor].append(l)
        }
        return subs.filter { !$0.isEmpty }
    }

    /// El precio de la etiqueta es el de la línea más alta que contenga uno
    /// (en góndola el precio es el texto grande). Sin precio no hay etiqueta.
    private static func construir(_ lineas: [LineaOCR]) -> Region? {
        let orden = lineas.sorted { ($0.caja.y0, $0.caja.x0) < ($1.caja.y0, $1.caja.x0) }
        let conPrecio = orden.filter { !precios(en: $0.text).isEmpty }
        guard let lineaPrecio = conPrecio.max(by: { $0.caja.alto < $1.caja.alto }),
              let precio = precios(en: lineaPrecio.text).first else { return nil }
        let caja = orden.dropFirst().reduce(orden[0].caja) { $0.union($1.caja) }
        let vr = orden.dropFirst().reduce(orden[0].visionRect) { $0.union($1.visionRect) }
        return Region(caja: caja, visionRect: vr, lineas: orden, texto: orden.map(\.text).joined(separator: "\n"), precio: precio)
    }

    /// Firma estable de una etiqueta: precio + primera palabra con letras.
    static func firma(_ r: Region) -> String {
        let palabra = r.texto.lowercased()
            .components(separatedBy: CharacterSet.alphanumerics.inverted)
            .first { $0.count >= 3 && $0.rangeOfCharacter(from: .letters) != nil } ?? ""
        return "\(r.precio)|\(palabra)"
    }
}

/// Sigue las etiquetas entre fotogramas: empareja por posición (IoU) y, si la
/// cámara saltó, por firma; confirma a la segunda vista; olvida las que dejan
/// de verse; nunca vuelve a entregar una firma ya entregada.
final class SeguimientoVivo {

    final class Pista {
        let id: String
        var vistas = 0
        var confirmada = false
        var ultimaVez: TimeInterval
        var caja: Caja
        var region: Region
        var firma: String

        init(id: String, region: Region, ahora: TimeInterval) {
            self.id = id
            self.region = region
            self.caja = region.caja
            self.firma = EtiquetasVivo.firma(region)
            self.ultimaVez = ahora
        }
    }

    let confirmarTras: Int
    let olvidar: TimeInterval
    private(set) var pistas: [Pista] = []
    private var entregadas = Set<String>()
    private var seq = 0

    init(confirmarTras: Int = 2, olvidar: TimeInterval = 1.5) {
        self.confirmarTras = confirmarTras
        self.olvidar = olvidar
    }

    func actualizar(_ regiones: [Region], ahora: TimeInterval) -> (visibles: [Pista], nuevas: [Pista]) {
        var libres = pistas
        var asignadas: [Int: Pista] = [:]

        for (i, r) in regiones.enumerated() {
            var mejor: Pista? = nil, mejorIou = 0.3
            for p in libres where p.region.precio == r.precio {
                let v = r.caja.iou(p.caja)
                if v > mejorIou { mejor = p; mejorIou = v }
            }
            if let m = mejor { asignadas[i] = m; libres.removeAll { $0 === m } }
        }
        for (i, r) in regiones.enumerated() where asignadas[i] == nil {
            let f = EtiquetasVivo.firma(r)
            if let m = libres.first(where: { $0.firma == f }) { asignadas[i] = m; libres.removeAll { $0 === m } }
        }

        var nuevas: [Pista] = []
        for (i, r) in regiones.enumerated() {
            let p: Pista
            if let a = asignadas[i] {
                p = a
                p.caja = p.caja.suavizada(hacia: r.caja)
                p.region = r
                p.firma = EtiquetasVivo.firma(r)
            } else {
                seq += 1
                p = Pista(id: "t\(seq)", region: r, ahora: ahora)
                pistas.append(p)
            }
            p.vistas += 1
            p.ultimaVez = ahora
            if !p.confirmada && p.vistas >= confirmarTras {
                p.confirmada = true
                if !entregadas.contains(p.firma) {
                    entregadas.insert(p.firma)
                    nuevas.append(p)
                }
            }
        }
        pistas.removeAll { ahora - $0.ultimaVez > olvidar }
        return (pistas, nuevas)
    }

    /// Confirmación manual (toque en pantalla). Nil si ya estaba entregada.
    func confirmar(id: String) -> Pista? {
        guard let p = pistas.first(where: { $0.id == id }), !p.confirmada else { return nil }
        p.confirmada = true
        if entregadas.contains(p.firma) { return nil }
        entregadas.insert(p.firma)
        return p
    }

    func reiniciar() {
        pistas.removeAll()
        entregadas.removeAll()
    }
}
