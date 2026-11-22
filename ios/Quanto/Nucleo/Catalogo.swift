import Foundation

/// Catálogo local (web/data/catalogo.json, el mismo que usa la web) y
/// búsqueda por código de barras en Open Food Facts.
struct ProductoCatalogo: Decodable, Hashable, Identifiable {
    var n: String
    var m: String?
    var c: Double?
    var u: String?
    var e: Double?
    var p: Double?
    var t: String?
    var b: String?

    var id: String { n }
    var nombre: String { n }
}

enum Catalogo {

    private struct Archivo: Decodable {
        var actualizado: String?
        var productos: [ProductoCatalogo]
    }

    private static let productos: [ProductoCatalogo] = {
        guard let url = Bundle.main.url(forResource: "catalogo", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let a = try? JSONDecoder().decode(Archivo.self, from: data) else { return [] }
        return a.productos
    }()

    private static func normalizar(_ s: String) -> String {
        s.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "es"))
    }

    /// Igual que searchProduct de web/data/api.js: cuenta cuántas palabras de
    /// la consulta aparecen y premia al que empieza por la primera.
    static func buscar(_ consulta: String, limite: Int = 6) -> [ProductoCatalogo] {
        let q = normalizar(consulta).trimmingCharacters(in: .whitespaces)
        guard q.count >= 2 else { return [] }
        let palabras = q.split(separator: " ").map(String.init)
        var puntuados: [(ProductoCatalogo, Int)] = []
        for p in productos {
            let objetivo = normalizar("\(p.n) \(p.m ?? "")")
            var puntos = palabras.filter { objetivo.contains($0) }.count
            if puntos == palabras.count, let primera = palabras.first, objetivo.hasPrefix(primera) { puntos += 2 }
            if puntos > 0 { puntuados.append((p, puntos)) }
        }
        return puntuados
            .sorted { $0.1 != $1.1 ? $0.1 > $1.1 : $0.0.n.count < $1.0.n.count }
            .prefix(limite)
            .map(\.0)
    }

    struct PorCodigo {
        var nombre: String?
        var marca: String?
        var cantidadTexto: String?
        var contenido: Double?
        var unidad: String?
    }

    /// Open Food Facts primero (6 s); sin red, el catálogo local.
    static func porCodigo(_ codigo: String) async -> PorCodigo? {
        let limpio = codigo.filter(\.isNumber)
        guard limpio.count >= 8 else { return nil }
        if let url = URL(string: "https://world.openfoodfacts.org/api/v2/product/\(limpio).json?fields=product_name_es,product_name,brands,quantity") {
            var req = URLRequest(url: url, timeoutInterval: 6)
            req.setValue("Quanto/2.0 (iOS)", forHTTPHeaderField: "User-Agent")
            if let respuesta = try? await URLSession.shared.data(for: req),
               (respuesta.1 as? HTTPURLResponse)?.statusCode == 200,
               let obj = try? JSONSerialization.jsonObject(with: respuesta.0) as? [String: Any],
               let pr = obj["product"] as? [String: Any] {
                let nombre = (pr["product_name_es"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? (pr["product_name"] as? String)
                return PorCodigo(nombre: nombre, marca: pr["brands"] as? String, cantidadTexto: pr["quantity"] as? String)
            }
        }
        guard let p = productos.first(where: { $0.b == limpio }) else { return nil }
        return PorCodigo(nombre: p.n, marca: p.m, contenido: p.c, unidad: p.u)
    }
}
