import Foundation
import Observation

/// Fachada de los datos para las vistas. Cada lectura va a la lógica JS
/// (store.js, ahorro.js) y cada escritura sube `revision`: como las lecturas
/// leen `revision`, SwiftUI vuelve a pintar lo que dependa de ellas.
@MainActor
@Observable
final class Datos {

    static let compartido = Datos()

    private let motor: MotorJS
    private(set) var revision = 0

    init(motor: MotorJS = .compartido) {
        self.motor = motor
    }

    private func leyendo() { _ = revision }
    private func cambio() { revision &+= 1 }

    /// Diccionario para JSON: los nil pasan como null.
    private func json(_ d: [String: Any?]) -> [String: Any] {
        d.mapValues { $0 ?? NSNull() }
    }

    // MARK: - Listas

    func listas() -> [Lista] {
        leyendo()
        return motor.valor(Tolerante<Lista>.self, "getListas")?.valores ?? []
    }

    func listasActivas() -> [Lista] {
        listas().filter(\.activa).sorted { ($0.creadaEn ?? 0) > ($1.creadaEn ?? 0) }
    }

    func historial() -> [Lista] {
        leyendo()
        return motor.valor(Tolerante<Lista>.self, "getHistorialListasCerradas")?.valores ?? []
    }

    func lista(_ id: String) -> Lista? {
        listas().first { $0.id == id }
    }

    /// La lista activa; si no hay ninguna, la lógica crea "Mi lista".
    func listaActivaId() -> String {
        leyendo()
        return motor.valor(String.self, "getListaActivaId") ?? ""
    }

    func listaActiva() -> Lista? {
        lista(listaActivaId())
    }

    @discardableResult
    func crearLista(nombre: String, tienda: String?, presupuesto: Double? = nil) -> Lista? {
        let limpio = nombre.trimmingCharacters(in: .whitespacesAndNewlines)
        let tiendaLimpia = tienda?.trimmingCharacters(in: .whitespacesAndNewlines)
        let nueva = motor.valor(Lista.self, "crearLista", [limpio.isEmpty ? "Nueva lista" : limpio, (tiendaLimpia?.isEmpty ?? true) ? nil : tiendaLimpia])
        if let n = nueva, let p = presupuesto, p > 0 { motor.llamar("setPresupuesto", [n.id, p]) }
        cambio()
        return nueva
    }

    func editarLista(_ id: String, nombre: String, tienda: String?, presupuesto: Double?) {
        let limpio = nombre.trimmingCharacters(in: .whitespacesAndNewlines)
        let t = tienda?.trimmingCharacters(in: .whitespacesAndNewlines)
        var cambios: [String: Any?] = ["comercio_principal": (t?.isEmpty ?? true) ? nil : t]
        if !limpio.isEmpty { cambios["nombre"] = limpio }
        motor.llamar("actualizarLista", [id, json(cambios)])
        motor.llamar("setPresupuesto", [id, presupuesto ?? 0])
        cambio()
    }

    func activar(_ id: String) {
        motor.llamar("setListaActiva", [id])
        cambio()
    }

    @discardableResult
    func duplicar(_ id: String) -> Lista? {
        let nueva = motor.valor(Lista.self, "duplicarLista", [id, nil])
        cambio()
        return nueva
    }

    /// Cierra la compra con el total del recibo. Como en la web: la base para
    /// "pagaste más/menos" es lo verificado en góndola antes de facturar, y
    /// cada item queda facturado con su precio de referencia.
    @discardableResult
    func cerrarCompra(_ listaId: String, totalPagado: Double?) -> Lista? {
        let base = totales(listaId).totalVerificado
        var suma = 0.0
        for it in items(listaId) where !it.aplazado {
            let ref = it.estadoPrecio == EstadoPrecio.verificadoEnTienda.rawValue ? (it.precioVerificado ?? 0) : (it.precioEstimado ?? 0)
            suma += ref * it.piezas
            motor.llamar("facturarItem", [it.id, ref])
        }
        let cerrada = motor.valor(Lista.self, "cerrarLista", [listaId, totalPagado ?? suma, base])
        cambio()
        return cerrada
    }

    // MARK: - Items

    func items(_ listaId: String) -> [Item] {
        leyendo()
        return motor.valor(Tolerante<Item>.self, "getLista", [listaId])?.valores ?? []
    }

    func totales(_ listaId: String) -> Totales {
        leyendo()
        return motor.valor(Totales.self, "calcularTotales", [listaId]) ?? .cero
    }

    struct NuevoItem {
        var nombre: String
        var cantidad: Double = 1
        var precio: Double?
        var contenido: Double?
        var unidad: String?
        var verificado = false
        var fuente = "manual"
        var listaId: String?
    }

    @discardableResult
    func agregar(_ n: NuevoItem) -> Item? {
        let verificado = n.verificado && (n.precio ?? 0) > 0
        let item = motor.valor(Item.self, "guardarProducto", [json([
            "nombre": n.nombre.trimmingCharacters(in: .whitespacesAndNewlines),
            "cantidad": max(1, n.cantidad),
            "contenido": (n.contenido ?? 0) > 0 ? n.contenido : nil,
            "unidad_medida": (n.contenido ?? 0) > 0 ? n.unidad : nil,
            "precio_estimado": n.precio ?? 0,
            "precio_verificado": verificado ? n.precio : nil,
            "estado_precio": verificado ? EstadoPrecio.verificadoEnTienda.rawValue : EstadoPrecio.estimado.rawValue,
            "fuente": n.fuente,
            "lista_id": n.listaId,
        ])])
        cambio()
        return item
    }

    func editarItem(_ id: String, nombre: String, cantidad: Double, precio: Double?, contenido: Double?, unidad: String?) {
        guard let actual = buscarItem(id) else { return }
        var cambios: [String: Any?] = [
            "nombre": nombre.trimmingCharacters(in: .whitespacesAndNewlines),
            "cantidad": max(1, cantidad),
            "contenido": (contenido ?? 0) > 0 ? contenido : nil,
            "unidad_medida": (contenido ?? 0) > 0 ? unidad : nil,
        ]
        // El precio editado va al estado en que está el item.
        if actual.estadoPrecio == EstadoPrecio.estimado.rawValue { cambios["precio_estimado"] = precio ?? 0 }
        motor.llamar("actualizarItem", [id, json(cambios)])
        if actual.estadoPrecio != EstadoPrecio.estimado.rawValue, let p = precio, p > 0, p != actual.precioVigente {
            motor.llamar("verificarEnTienda", [id, p])
        }
        cambio()
    }

    func eliminarItem(_ id: String) {
        motor.llamar("eliminarItem", [id])
        cambio()
    }

    /// Precio visto en la góndola: pasa a verificado y queda en la memoria.
    func verificar(_ id: String, precio: Double) {
        motor.llamar("verificarEnTienda", [id, precio])
        cambio()
    }

    /// Devuelve false si el item aún no tiene precio verificado (hay que pedirlo).
    @discardableResult
    func alCarrito(_ id: String, _ dentro: Bool) -> Bool {
        let r = motor.valor(Item.self, "marcarEnCarrito", [id, dentro])
        cambio()
        return r != nil
    }

    func aplazar(_ id: String) {
        motor.llamar("aplazarItem", [id, nil])
        cambio()
    }

    func reactivar(_ id: String) {
        motor.llamar("reactivarItem", [id])
        cambio()
    }

    func buscarItem(_ id: String) -> Item? {
        leyendo()
        for l in listas() {
            if let it = items(l.id).first(where: { $0.id == id }) { return it }
        }
        return nil
    }

    /// Un item de la lista con el mismo producto (misma clave de nombre).
    func itemSimilar(_ nombre: String, en listaId: String) -> Item? {
        let c = clave(nombre)
        guard !c.isEmpty else { return nil }
        return items(listaId).first { clave($0.nombre) == c }
    }

    // MARK: - Comparaciones

    struct ProductoComparado {
        var nombre: String
        var precio: Double
        var totalContenido: Double
        var unidad: String
        var normalizado: Double
    }

    /// Guarda la comparación; cada producto queda como precio visto en la memoria.
    func guardarComparacion(origen: String, productos: [ProductoComparado]) {
        guard !productos.isEmpty else { return }
        let items: [[String: Any]] = productos.map { p -> [String: Any] in
            ["nombre": p.nombre, "precio": p.precio, "totalContenido": p.totalContenido, "unidad": p.unidad, "normalizado": p.normalizado]
        }
        let carga: [String: Any] = ["origen": origen, "items": items]
        motor.llamar("guardarComparacion", [carga])
        cambio()
    }

    // MARK: - Memoria de precios y ahorro

    func clave(_ nombre: String) -> String {
        motor.valor(String.self, "claveProducto", [nombre]) ?? ""
    }

    /// Precio por 100 g/ml (o por unidad); nil sin contenido.
    func normalizado(precio: Double?, contenido: Double?, unidad: String?, unidades: Double = 1) -> Double? {
        guard let p = precio, p > 0, let c = contenido, c > 0 else { return nil }
        let args: [String: Any] = ["precio": p, "contenido": c, "unidad": unidad ?? "g", "unidades": max(1, unidades)]
        return motor.valor(Double.self, "precioNormalizado", [args])
    }

    func semaforo(nombre: String, precio: Double?, contenido: Double?, unidad: String?, unidades: Double = 1) -> Semaforo {
        leyendo()
        guard let p = precio, p > 0, !nombre.trimmingCharacters(in: .whitespaces).isEmpty else { return .vacio }
        return motor.valor(Semaforo.self, "semaforoPrecio", [json([
            "nombre": nombre, "precio": p, "contenido": contenido, "unidad": unidad, "unidades": max(1, unidades),
        ])]) ?? .vacio
    }

    func semaforo(de item: Item) -> Semaforo {
        semaforo(nombre: item.nombre, precio: item.precioVigente, contenido: item.contenido, unidad: item.unidadMedida)
    }

    func estadisticas(_ nombre: String) -> Estadisticas? {
        leyendo()
        return motor.valor(Estadisticas.self, "estadisticasProducto", [nombre])
    }

    func productosConMemoria() -> [Estadisticas] {
        leyendo()
        return motor.valor(Tolerante<Estadisticas>.self, "productosConMemoria")?.valores ?? []
    }

    func resumen() -> ResumenAhorro? {
        leyendo()
        return motor.valor(ResumenAhorro.self, "resumenAhorro")
    }

    func sugerencias(_ listaId: String, limite: Int = 6) -> [Frecuente] {
        leyendo()
        return motor.valor(Tolerante<Frecuente>.self, "sugerenciasRecompra", [listaId, ["limite": limite]])?.valores ?? []
    }

    func consejos(listaId: String?, limite: Int = 5) -> [Consejo] {
        leyendo()
        return motor.valor(Tolerante<Consejo>.self, "consejos", [json(["listaId": listaId, "limite": limite])])?.valores ?? []
    }

    /// Texto con los números reales para que Apple Intelligence redacte el consejo.
    func textoCoach(listaId: String?) -> String {
        leyendo()
        return motor.valor(String.self, "resumenParaCoach", [json(["listaId": listaId])]) ?? ""
    }

    // MARK: - Etiquetas

    /// Texto y palabras de Vision -> precio, contenido, envases y nombre (parser de la web).
    func leerEtiqueta(texto: String, palabras: [[String: Any]], precioRespaldo: Double = 0) -> LecturaEtiqueta {
        motor.valor(LecturaEtiqueta.self, "leerVision", [texto, palabras, precioRespaldo]) ?? LecturaEtiqueta()
    }

    /// "Atún lomitos 3 x 170 g" -> contenido 170, unidad g, unidades 3.
    func medidaDeNombre(_ nombre: String) -> LecturaEtiqueta? {
        motor.valor(LecturaEtiqueta.self, "extraerMedidaDeNombre", [nombre])
    }

    // MARK: - Ajustes y copia de seguridad

    func ajustes() -> Ajustes {
        leyendo()
        return motor.valor(Ajustes.self, "getAjustes") ?? Ajustes()
    }

    func guardarAjustes(tienda: String, presupuesto: Double?) {
        let t = tienda.trimmingCharacters(in: .whitespacesAndNewlines)
        motor.llamar("setAjustes", [json(["tienda_habitual": t, "presupuesto_defecto": (presupuesto ?? 0) > 0 ? presupuesto : nil])])
        cambio()
    }

    /// Copia de seguridad: el mismo JSON que exporta la web.
    func exportarJSON() -> Data? {
        guard let datos = motor.llamar("exportarDatos"),
              let obj = try? JSONSerialization.jsonObject(with: datos) as? [String: Any],
              let r = obj["r"] else { return nil }
        return try? JSONSerialization.data(withJSONObject: r, options: [.prettyPrinted, .sortedKeys])
    }

    enum FalloImportacion: LocalizedError {
        case formato
        var errorDescription: String? { "El archivo no es una copia de Quanto." }
    }

    func importar(_ data: Data, reemplazar: Bool) throws -> ResultadoImportacion {
        guard let texto = String(data: data, encoding: .utf8),
              let r = motor.valor(ResultadoImportacion.self, "importarDatos", [texto, reemplazar ? "reemplazar" : "fusionar"]) else {
            throw FalloImportacion.formato
        }
        cambio()
        return r
    }

    /// Datos del localStorage de la versión anterior (web dentro de la app).
    func importarDesdeWeb(_ crudo: [String: String]) -> ResultadoImportacion? {
        let r = motor.valor(ResultadoImportacion.self, "importarDesdeWeb", [crudo])
        cambio()
        return r
    }

    func esperarGuardado() {
        motor.esperarGuardado()
    }
}
