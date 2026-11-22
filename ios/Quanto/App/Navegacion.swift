import SwiftUI
import Observation

enum Pestana: Hashable {
    case inicio, comparar, listas, ahorro
}

/// Estado de navegación compartido: pestañas, escáner y rutas. Lo usan las
/// vistas, los consejos ("ir a…") y los atajos de Siri.
@MainActor
@Observable
final class Navegacion {
    static let compartida = Navegacion()

    var pestana: Pestana = .inicio
    var escanerAbierto = false
    /// Ruta de la pestaña Listas (ids de lista).
    var rutaListas: [String] = []

    func abrirEscaner() {
        escanerAbierto = true
    }

    func abrirLista(_ id: String) {
        pestana = .listas
        rutaListas = [id]
    }

    /// Acción "goto" de los consejos de web/data/ahorro.js.
    func ir(_ destino: String) {
        switch destino {
        case "listas": pestana = .listas
        case "ahorro": pestana = .ahorro
        case "comparar": pestana = .comparar
        case "escanear": abrirEscaner()
        default: pestana = .inicio
        }
    }
}
