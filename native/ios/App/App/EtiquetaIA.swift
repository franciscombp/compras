import Foundation

#if canImport(FoundationModels)
import FoundationModels
#endif

/// Interpretación de la etiqueta con el modelo local de Apple Intelligence
/// (framework Foundation Models, iOS 26+, solo en dispositivos compatibles).
/// Recibe el texto que leyó Vision y devuelve la misma estructura que el
/// parser de assets/ocr.js. Si no está disponible, la app usa el parser
/// de expresiones regulares con el texto de Vision.
enum EtiquetaIA {

    static let instrucciones = """
    Eres el lector de etiquetas de Quanto, una app que compara precios de supermercado en Ecuador (dólares).
    Recibes el texto OCR de una etiqueta de góndola o empaque, con posibles errores de lectura. Extrae solo lo que aparece; si un dato no está, déjalo en null. No inventes.
    - precio: el precio vigente que paga el cliente. Con "antes/ahora" o un precio tachado, usa el vigente. Promo "2 x $5.00": precio 5.00 y unidades 2. Centavos elevados ("1 99") significan 1.99.
    - Ignora precios de referencia por kg, por 100 g o c/u salvo que sean lo único que hay.
    - contenido: contenido neto de UN envase en g o ml (kg a g, l a ml, lb a 453.6 g, oz a 28.35 g). Peso neto antes que escurrido. Pack "6 x 80 g": contenido 80, unidades 6.
    - Productos por piezas (huevos, pañales, rollos): unidad "unidad" y contenido = piezas.
    - nombre: corto, en español, con marca si aparece; sin precios ni promos.
    """

    static func disponible() -> Bool {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            if case .available = SystemLanguageModel.default.availability { return true }
        }
        #endif
        return false
    }

    /// Devuelve un diccionario listo para el puente de Capacitor, o nil si
    /// el modelo no está disponible en este dispositivo.
    static func interpretar(texto: String) async throws -> [String: Any]? {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            guard case .available = SystemLanguageModel.default.availability else { return nil }
            let session = LanguageModelSession(instructions: instrucciones)
            let respuesta = try await session.respond(
                to: "Texto de la etiqueta:\n\(texto)",
                generating: EtiquetaGenerada.self
            )
            let e = respuesta.content
            let unidad: String? = ["g", "ml", "unidad"].contains(e.unidad) ? e.unidad : nil
            let contenido: Double? = {
                guard let c = e.contenido, c > 0, unidad != nil else { return nil }
                return c.rounded()
            }()
            let precio: Double? = {
                guard let p = e.precio, p > 0, p <= 5000 else { return nil }
                return (p * 100).rounded() / 100
            }()
            return [
                "precio": precio ?? NSNull(),
                "contenido": contenido ?? NSNull(),
                "unidad": (contenido != nil ? unidad : nil) ?? NSNull(),
                "unidades": min(48, max(1, e.unidades)),
                "nombre": String(e.nombre.trimmingCharacters(in: .whitespacesAndNewlines).prefix(80)),
                "confianza": e.confianza,
            ]
        }
        #endif
        return nil
    }
}

#if canImport(FoundationModels)
@available(iOS 26.0, *)
@Generable(description: "Datos de una etiqueta de precio de supermercado")
struct EtiquetaGenerada {
    @Guide(description: "Precio actual de venta en dólares por lo que cubre `unidades`. null si no se ve.")
    var precio: Double?

    @Guide(description: "Contenido neto de UN envase ya convertido a g o ml, o número de piezas si unidad es 'unidad'. null si no se ve.")
    var contenido: Double?

    @Guide(description: "Base del contenido: g, ml, unidad; o ninguna si no se ve.", .anyOf(["g", "ml", "unidad", "ninguna"]))
    var unidad: String

    @Guide(description: "Cuántos envases cubre el precio: 1 salvo packs o promos 'N x'.")
    var unidades: Int

    @Guide(description: "Nombre corto del producto con marca si se ve. Vacío si no se lee.")
    var nombre: String

    @Guide(description: "alta si precio y contenido se leen con claridad; media si falta uno; baja si hubo que adivinar.", .anyOf(["alta", "media", "baja"]))
    var confianza: String
}
#endif
