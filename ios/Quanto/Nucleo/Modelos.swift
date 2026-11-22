import Foundation

// Modelos que devuelve la lógica JS (web/data/store.js y web/data/ahorro.js).
// Los nombres siguen a la web en camelCase (lista_id -> listaId). Las fechas
// llegan en milisegundos desde 1970, como en JavaScript.

/// Lee un arreglo sin perderlo entero si un elemento viene roto.
struct Tolerante<T: Decodable>: Decodable {
    let valores: [T]
    init(from decoder: Decoder) throws {
        var c = try decoder.unkeyedContainer()
        var out: [T] = []
        while !c.isAtEnd {
            if let v = try? c.decode(T.self) { out.append(v) } else { _ = try? c.decode(Descartado.self) }
        }
        valores = out
    }
    /// Acepta cualquier valor: sirve para saltar el elemento que no se pudo leer.
    private struct Descartado: Decodable {
        init(from decoder: Decoder) throws {}
    }
}

extension KeyedDecodingContainer {
    /// Número que puede venir como número o como texto.
    func numero(_ clave: Key) -> Double? {
        if let d = try? decodeIfPresent(Double.self, forKey: clave) { return d }
        if let s = try? decodeIfPresent(String.self, forKey: clave) { return Formato.leerNumero(s) }
        return nil
    }
}

extension Double {
    /// Milisegundos de JavaScript -> Date.
    var fechaJS: Date { Date(timeIntervalSince1970: self / 1000) }
}

enum EstadoPrecio: String, Codable {
    case estimado, verificadoEnTienda = "verificado_en_tienda", facturado
}

enum EstadoCompra: String, Codable {
    case activo, enCarrito = "en_carrito", aplazado
}

struct Lista: Codable, Identifiable, Hashable {
    var id: String
    var nombre: String
    var creadaEn: Double?
    var estado: String
    var comercioPrincipal: String?
    var presupuesto: Double?
    var totalFacturadoFinal: Double?
    var diferenciaVsVerificado: Double?
    var cerradaEn: Double?

    var activa: Bool { estado == "activa" }
    var fecha: Date { (cerradaEn ?? creadaEn ?? 0).fechaJS }
}

struct Item: Decodable, Identifiable, Hashable {
    var id: String
    var listaId: String
    var nombre: String
    var comercio: String?
    var cantidad: Double?
    var contenido: Double?
    var unidadMedida: String?
    var estadoPrecio: String
    var estadoCompra: String
    var precioEstimado: Double?
    var precioVerificado: Double?
    var precioFacturado: Double?
    var motivoAplazado: String?
    var fuente: String?
    var creadoEn: Double?

    private enum CodingKeys: String, CodingKey {
        case id, listaId, nombre, comercio, cantidad, contenido, unidadMedida, estadoPrecio, estadoCompra
        case precioEstimado, precioVerificado, precioFacturado, motivoAplazado, fuente, creadoEn
    }

    /// Los números pueden venir como texto en datos viejos ("2", "1,25"): se aceptan igual.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        listaId = try c.decode(String.self, forKey: .listaId)
        nombre = (try? c.decode(String.self, forKey: .nombre)) ?? "Producto"
        comercio = try? c.decodeIfPresent(String.self, forKey: .comercio)
        cantidad = c.numero(.cantidad)
        contenido = c.numero(.contenido)
        unidadMedida = try? c.decodeIfPresent(String.self, forKey: .unidadMedida)
        estadoPrecio = (try? c.decode(String.self, forKey: .estadoPrecio)) ?? EstadoPrecio.estimado.rawValue
        estadoCompra = (try? c.decode(String.self, forKey: .estadoCompra)) ?? EstadoCompra.activo.rawValue
        precioEstimado = c.numero(.precioEstimado)
        precioVerificado = c.numero(.precioVerificado)
        precioFacturado = c.numero(.precioFacturado)
        motivoAplazado = try? c.decodeIfPresent(String.self, forKey: .motivoAplazado)
        fuente = try? c.decodeIfPresent(String.self, forKey: .fuente)
        creadoEn = c.numero(.creadoEn)
    }

    var piezas: Double { max(1, cantidad ?? 1) }
    var verificado: Bool { estadoPrecio == EstadoPrecio.verificadoEnTienda.rawValue || estadoPrecio == EstadoPrecio.facturado.rawValue }
    var enCarrito: Bool { estadoCompra == EstadoCompra.enCarrito.rawValue }
    var aplazado: Bool { estadoCompra == EstadoCompra.aplazado.rawValue }

    /// El precio que cuenta: facturado > verificado > estimado.
    var precioVigente: Double {
        switch estadoPrecio {
        case EstadoPrecio.facturado.rawValue: return precioFacturado ?? 0
        case EstadoPrecio.verificadoEnTienda.rawValue: return precioVerificado ?? 0
        default: return precioEstimado ?? 0
        }
    }
}

struct Totales: Codable, Hashable {
    var totalEstimado: Double
    var totalVerificado: Double
    var totalFacturado: Double?
    var totalAplazado: Double
    var countActivos: Int
    var countVerificados: Int
    var countFacturados: Int
    var countAplazados: Int
    var countEnCarrito: Int

    static let cero = Totales(totalEstimado: 0, totalVerificado: 0, totalFacturado: nil, totalAplazado: 0,
                              countActivos: 0, countVerificados: 0, countFacturados: 0, countAplazados: 0, countEnCarrito: 0)
}

/// Resultado del parser de etiquetas (parseEtiqueta).
struct LecturaEtiqueta: Codable, Hashable {
    var precio: Double?
    var contenido: Double?
    var unidad: String?
    var unidades: Double?
    var nombre: String?
    var precioNoAfiliado: Double?
    var codigo: String?
}

struct PuntoPrecio: Codable, Hashable {
    var valor: Double
    var precio: Double
    var fecha: Double
    var tienda: String?
}

struct TiendaPrecio: Codable, Hashable {
    var tienda: String
    var mediana: Double
    var n: Int
    var ultima: Double
}

struct PuntoSerie: Codable, Hashable {
    var fecha: Double
    var valor: Double
    var precio: Double
    var tienda: String?
    var fuente: String?
}

/// Lo que la memoria sabe de un producto (estadisticasProducto).
struct Estadisticas: Codable, Hashable, Identifiable {
    var clave: String
    var nombre: String
    var n: Int
    var baseNormalizada: Bool
    var base: String
    var unidad: String?
    var ultimo: PuntoPrecio
    var minimo: PuntoPrecio
    var habitual: Double?
    var tendencia: Int
    var tiendas: [TiendaPrecio]
    var serie: [PuntoSerie]

    var id: String { clave }
}

enum NivelSemaforo: String, Codable {
    case bueno, normal, caro, sinDatos = "sin_datos"
}

struct Semaforo: Codable, Hashable {
    var nivel: NivelSemaforo
    var texto: String
    var delta: Double?
    var valor: Double?
    var stats: Estadisticas?

    static let vacio = Semaforo(nivel: .sinDatos, texto: "", delta: nil, valor: nil, stats: nil)
}

/// Producto que compras seguido (productosFrecuentes / sugerenciasRecompra).
struct Frecuente: Codable, Hashable, Identifiable {
    var clave: String
    var nombre: String
    var veces: Int
    var intervaloDias: Int?
    var diasDesde: Int
    var toca: Bool
    var gasto: Double
    var contenido: Double?
    var unidad: String?
    var precioRef: Double?
    var motivo: String?

    var id: String { clave }
}

struct EjemploTienda: Codable, Hashable {
    var nombre: String
    var pct: Int
    var vs: String
}

struct ComparativaTienda: Codable, Hashable, Identifiable {
    var tienda: String
    var gana: Int
    var compara: Int
    var ratio: Double
    var ejemplos: [EjemploTienda]

    var id: String { tienda }
}

struct GastoProducto: Codable, Hashable, Identifiable {
    var clave: String
    var nombre: String
    var gasto: Double
    var pct: Double

    var id: String { clave }
}

struct ResumenAhorro: Codable, Hashable {
    var compras: Int
    var gastoMes: Double
    var gastoAnterior: Double
    var variacionMes: Double?
    var comprasMes: Int
    var ticketPromedio: Double
    var ahorroComparando: Double
    var comparacionesConAhorro: Int
    var menosQueVerificado: Double
    var masQueVerificado: Double
    var productosEnMemoria: Int
    var observaciones: Int
    var topGasto: [GastoProducto]
    var frecuentes: [Frecuente]
    var tiendas: [ComparativaTienda]
}

struct AccionConsejo: Codable, Hashable {
    var goto: String?
    var agregar: String?
}

struct Consejo: Codable, Hashable, Identifiable {
    var tipo: String
    var titulo: String
    var texto: String
    var accion: AccionConsejo?

    var id: String { tipo + "·" + titulo }

    var simbolo: String {
        switch tipo {
        case "caro": return "exclamationmark.triangle.fill"
        case "tienda": return "storefront.fill"
        case "recompra": return "arrow.clockwise"
        case "subida": return "arrow.up.right"
        case "caja": return "receipt"
        case "gasto": return "chart.pie.fill"
        case "mes": return "calendar"
        default: return "sparkles"
        }
    }
}

struct Ajustes: Codable, Hashable {
    var tiendaHabitual: String?
    var presupuestoDefecto: Double?
}

struct ResultadoImportacion: Codable, Hashable {
    var listas: Int
    var items: Int
    var precios: Int
    var vacio: Bool?
}
