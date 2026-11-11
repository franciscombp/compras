import Foundation

#if canImport(FoundationModels)
import FoundationModels
#endif

/// Apple Intelligence en el dispositivo (framework Foundation Models, iOS 26+).
/// Tres tareas, todas con salida estructurada (@Generable):
///   - etiqueta(texto:)   texto OCR de una etiqueta -> precio, contenido, unidad, envases, nombre
///   - producto(frase:)   frase dictada o escrita    -> nombre, cantidad, precio, contenido, unidad
///   - veredicto(resumen:) comparación ya calculada  -> título y explicación breves
/// Si el modelo no está disponible, cada función devuelve nil y la web usa su
/// lógica local (parser de expresiones regulares, texto fijo).
enum AppleIA {

    static let contexto = """
    Trabajas dentro de Quanto, una app para comparar precios de supermercado en Ecuador (dólares). \
    Responde solo con los datos pedidos. Nunca inventes un dato que no esté en el texto: déjalo en null o vacío.
    """

    static func disponible() -> Bool {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            if case .available = SystemLanguageModel.default.availability { return true }
        }
        #endif
        return false
    }

    /// Carga el modelo en memoria al arrancar para que la primera lectura no espere.
    static func precalentar() {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *), disponible() {
            Task.detached(priority: .utility) {
                LanguageModelSession(instructions: contexto).prewarm()
            }
        }
        #endif
    }

    // MARK: - Etiqueta de góndola

    static func etiqueta(texto: String) async throws -> [String: Any]? {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *), disponible() {
            let instrucciones = contexto + """

            Recibes el texto OCR de una etiqueta de góndola o empaque, con posibles errores de lectura.
            - precio: el precio vigente que paga el cliente. Con "antes/ahora" o un precio tachado, usa el vigente. Promo "2 x $5.00": precio 5.00 y unidades 2. Centavos elevados ("1 99") significan 1.99.
            - Ignora precios de referencia por kg, por 100 g o c/u salvo que sean lo único que hay.
            - contenido: contenido neto de UN envase en g o ml (kg a g, l a ml, lb a 453.6 g, oz a 28.35 g). Peso neto antes que escurrido. Pack "6 x 80 g": contenido 80, unidades 6.
            - Productos por piezas (huevos, pañales, rollos): unidad "unidad" y contenido = piezas.
            - nombre: corto, en español, con marca si aparece; sin precios ni promos.
            """
            let session = LanguageModelSession(instructions: instrucciones)
            let e = try await session.respond(to: "Texto de la etiqueta:\n\(texto)", generating: EtiquetaGenerada.self).content
            let unidad = unidadValida(e.unidad)
            let contenido = positivo(e.contenido, requiere: unidad != nil).map { $0.rounded() }
            return [
                "precio": precioValido(e.precio) ?? NSNull(),
                "contenido": contenido ?? NSNull(),
                "unidad": (contenido != nil ? unidad : nil) ?? NSNull(),
                "unidades": min(48, max(1, e.unidades)),
                "nombre": limpiar(e.nombre),
                "confianza": e.confianza,
            ]
        }
        #endif
        return nil
    }

    // MARK: - Producto dictado o escrito

    static func producto(frase: String) async throws -> [String: Any]? {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *), disponible() {
            let instrucciones = contexto + """

            Recibes una frase que una persona dictó o escribió al agregar un producto a su lista de compras, por ejemplo \
            "dos leches Vita de litro a uno veinticinco" o "atún real 170 gramos 1.89" o "pan".
            - nombre: el producto, corto y con marca si la dice, sin números de cantidad ni precio.
            - cantidad: cuántas piezas va a llevar (1 si no lo dice).
            - precio: precio por pieza en dólares si lo dice ("uno veinticinco" es 1.25; "noventa centavos" es 0.90); null si no.
            - contenido y unidad: contenido de cada pieza en g o ml si lo dice ("de litro" es 1000 ml, "medio kilo" es 500 g); si no, null y unidad "ninguna".
            """
            let session = LanguageModelSession(instructions: instrucciones)
            let p = try await session.respond(to: "Frase: \(frase)", generating: ProductoGenerado.self).content
            let unidad = unidadValida(p.unidad)
            let contenido = positivo(p.contenido, requiere: unidad != nil).map { $0.rounded() }
            return [
                "nombre": limpiar(p.nombre),
                "cantidad": min(99, max(1, p.cantidad)),
                "precio": precioValido(p.precio) ?? NSNull(),
                "contenido": contenido ?? NSNull(),
                "unidad": (contenido != nil ? unidad : nil) ?? NSNull(),
            ]
        }
        #endif
        return nil
    }

    // MARK: - Explicación del veredicto

    static func veredicto(resumen: String) async throws -> [String: Any]? {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *), disponible() {
            let instrucciones = contexto + """

            Recibes una comparación ya calculada: cada producto con su precio, contenido total y precio por 100 g, 100 ml o unidad, \
            ordenados del más barato al más caro. Explica a la persona, en español sencillo y en máximo dos frases cortas, \
            por qué conviene el primero y qué trampa evitar (por ejemplo un pack que parece barato pero trae menos producto). \
            No repitas todos los números: usa solo los que ayuden a decidir. El título tiene máximo seis palabras.
            """
            let session = LanguageModelSession(instructions: instrucciones)
            let v = try await session.respond(to: resumen, generating: VeredictoGenerado.self).content
            return [
                "titulo": limpiar(v.titulo),
                "explicacion": v.explicacion.trimmingCharacters(in: .whitespacesAndNewlines),
            ]
        }
        #endif
        return nil
    }

    // MARK: - Saneado

    private static func unidadValida(_ u: String) -> String? {
        ["g", "ml", "unidad"].contains(u) ? u : nil
    }

    private static func positivo(_ v: Double?, requiere: Bool) -> Double? {
        guard requiere, let v = v, v > 0 else { return nil }
        return v
    }

    private static func precioValido(_ p: Double?) -> Double? {
        guard let p = p, p > 0, p <= 5000 else { return nil }
        return (p * 100).rounded() / 100
    }

    private static func limpiar(_ s: String) -> String {
        String(s.trimmingCharacters(in: .whitespacesAndNewlines).prefix(80))
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

@available(iOS 26.0, *)
@Generable(description: "Producto que una persona quiere agregar a su lista de compras")
struct ProductoGenerado {
    @Guide(description: "Nombre del producto, corto, con marca si la dice; sin cantidades ni precios.")
    var nombre: String

    @Guide(description: "Cuántas piezas va a llevar. 1 si no lo dice.")
    var cantidad: Int

    @Guide(description: "Precio por pieza en dólares si lo dice; null si no.")
    var precio: Double?

    @Guide(description: "Contenido de cada pieza en g o ml si lo dice; null si no.")
    var contenido: Double?

    @Guide(description: "g, ml, unidad; o ninguna si no dice contenido.", .anyOf(["g", "ml", "unidad", "ninguna"]))
    var unidad: String
}

@available(iOS 26.0, *)
@Generable(description: "Explicación breve de cuál producto conviene")
struct VeredictoGenerado {
    @Guide(description: "Título de máximo seis palabras, por ejemplo 'La lata suelta sale mejor'.")
    var titulo: String

    @Guide(description: "Una o dos frases cortas en español sencillo explicando por qué y qué trampa evitar.")
    var explicacion: String
}
#endif
