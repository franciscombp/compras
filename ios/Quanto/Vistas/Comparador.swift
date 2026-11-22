import SwiftUI
import Observation
import UIKit

/// Un producto del comparador. Se escribe a mano o llega del escáner.
struct Fila: Identifiable, Equatable {
    let id = UUID()
    var nombre = ""
    var precioTexto = ""
    var contenidoTexto = ""
    var unidad: UnidadEntrada = .g
    var unidades = 1
    var miniatura: UIImage?
    var precioNoAfiliado: Double?
    var codigo: String?
    /// Huella de la etiqueta (precio, contenido, nombre) para no duplicarla.
    var firma: String?
    /// Ids de las etiquetas del barrido que corresponden a esta fila.
    var idsBarrido: Set<String> = []
    var deEscaner = false
    /// La persona la tocó: Apple Intelligence ya no la reescribe.
    var editada = false
    var textoOCR = ""

    var precio: Double? { Formato.leerNumero(precioTexto).flatMap { $0 > 0 ? $0 : nil } }
    /// Contenido de un envase en g, ml o unidades.
    var contenido: Double? { Formato.leerNumero(contenidoTexto).flatMap { $0 > 0 ? $0 * unidad.factor : nil } }
    var vacia: Bool { nombre.isEmpty && precioTexto.isEmpty && contenidoTexto.isEmpty }

    /// Fila desde lo que leyó el parser de etiquetas.
    static func desde(_ l: LecturaEtiqueta) -> Fila {
        var f = Fila()
        f.nombre = l.nombre ?? ""
        f.precioTexto = l.precio.map { String(format: "%.2f", $0) } ?? ""
        let (u, c) = UnidadEntrada.desde(contenido: l.contenido, unidad: l.unidad)
        f.unidad = u
        f.contenidoTexto = Formato.texto(c)
        f.unidades = max(1, Int((l.unidades ?? 1).rounded()))
        f.precioNoAfiliado = l.precioNoAfiliado
        f.codigo = l.codigo
        f.deEscaner = true
        return f
    }

    static func huella(_ l: LecturaEtiqueta) -> String {
        let nombre = (l.nombre ?? "").lowercased().filter(\.isLetter).prefix(10)
        return "\(l.precio ?? 0)|\(l.contenido ?? 0)|\(l.unidades ?? 1)|\(nombre)"
    }
}

/// Lugar de una fila en el ranking.
struct Puesto: Identifiable {
    let fila: Fila
    let titulo: String
    let normalizado: Double
    let totalContenido: Double
    /// Cuánto más caro que el mejor (0.12 = 12 %).
    let sobreMejor: Double

    var id: UUID { fila.id }
}

@MainActor
@Observable
final class Comparador {
    static let compartido = Comparador()

    var filas: [Fila] = [Fila(), Fila()]

    func titulo(de fila: Fila) -> String {
        let n = fila.nombre.trimmingCharacters(in: .whitespaces)
        if !n.isEmpty { return n }
        let i = (filas.firstIndex { $0.id == fila.id } ?? 0) + 1
        return "Producto \(i)"
    }

    /// Del más barato al más caro por 100 g/ml (o por unidad).
    func ranking(_ datos: Datos) -> [Puesto] {
        let validos: [(Fila, Double, Double)] = filas.compactMap { f in
            guard let p = f.precio, let c = f.contenido,
                  let n = datos.normalizado(precio: p, contenido: c, unidad: f.unidad.base, unidades: Double(f.unidades)) else { return nil }
            return (f, n, c * Double(f.unidades))
        }
        let ordenados = validos.sorted { $0.1 < $1.1 }
        guard let mejor = ordenados.first?.1, mejor > 0 else { return [] }
        return ordenados.map { t in
            Puesto(fila: t.0, titulo: titulo(de: t.0), normalizado: t.1, totalContenido: t.2, sobreMejor: (t.1 - mejor) / mejor)
        }
    }

    /// Hay productos en g y en ml a la vez: la comparación es aproximada.
    func mezclaUnidades() -> Bool {
        Set(filas.filter { $0.precio != nil && $0.contenido != nil }.map { $0.unidad.base }).count > 1
    }

    func agregarFila() {
        filas.append(Fila())
    }

    /// Una fila del escáner ocupa el primer hueco vacío, o va al final.
    func incorporar(_ f: Fila) {
        if let i = filas.firstIndex(where: \.vacia) { filas[i] = f } else { filas.append(f) }
    }

    func limpiar() {
        filas = [Fila(), Fila()]
    }

    func ejemplo() {
        var a = Fila(); a.nombre = "Atún Real lomitos"; a.precioTexto = "1.89"; a.contenidoTexto = "170"
        var b = Fila(); b.nombre = "Atún Real pack"; b.precioTexto = "5.25"; b.contenidoTexto = "170"; b.unidades = 3
        var c = Fila(); c.nombre = "Atún Van Camps"; c.precioTexto = "1.65"; c.contenidoTexto = "140"
        filas = [a, b, c]
    }

    /// Apple Intelligence relee el texto; con código de barras, Open Food Facts completa.
    func afinar(_ id: UUID, texto: String, codigo: String?, datos: Datos, alCambiar: () -> Void = {}) async {
        if AppleIA.disponible(), let ia = try? await AppleIA.etiqueta(texto: texto),
           let i = filas.firstIndex(where: { $0.id == id }), !filas[i].editada {
            var f = filas[i]
            if !ia.nombre.isEmpty { f.nombre = ia.nombre }
            if let c = ia.contenido, let u = ia.unidad, f.contenido == nil || ia.confianza == "alta" {
                let (entrada, valor) = UnidadEntrada.desde(contenido: c, unidad: u)
                f.unidad = entrada
                f.contenidoTexto = Formato.texto(valor)
            }
            if ia.unidades > 1 && f.unidades == 1 { f.unidades = ia.unidades }
            filas[i] = f
            alCambiar()
        }
        guard let codigo = codigo,
              let i = filas.firstIndex(where: { $0.id == id }),
              filas[i].contenido == nil || filas[i].nombre.isEmpty,
              let p = await Catalogo.porCodigo(codigo),
              let j = filas.firstIndex(where: { $0.id == id }), !filas[j].editada else { return }
        var f = filas[j]
        if f.nombre.isEmpty, let n = p.nombre { f.nombre = [n, p.marca].compactMap { $0 }.joined(separator: " · ") }
        if f.contenido == nil {
            let medida = p.contenido != nil ? LecturaEtiqueta(contenido: p.contenido, unidad: p.unidad) : p.cantidadTexto.flatMap { datos.medidaDeNombre($0) }
            if let m = medida, let c = m.contenido {
                let (entrada, valor) = UnidadEntrada.desde(contenido: c, unidad: m.unidad)
                f.unidad = entrada
                f.contenidoTexto = Formato.texto(valor)
            }
        }
        filas[j] = f
        alCambiar()
    }

    /// Texto para que Apple Intelligence explique el veredicto.
    static func resumen(_ ranking: [Puesto]) -> String {
        ranking.enumerated().map { i, p in
            let medida = Formato.contenido(p.totalContenido, p.fila.unidad.base) ?? ""
            return "\(i + 1). \(p.titulo): \(Formato.precio(p.fila.precio)) por \(medida) -> \(Formato.normalizado(p.normalizado)) por \(Formato.base(p.fila.unidad.base))"
        }.joined(separator: "\n")
    }
}
