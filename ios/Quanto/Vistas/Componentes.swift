import SwiftUI
import UIKit

enum Estilo {
    /// Rojo Quanto (#c41e1e; #ff6b6b en modo oscuro), definido en Assets como AccentColor.
    static let marca = Color.accentColor
    static let bueno = Color.green
    static let caro = Color.red
    static let aviso = Color.orange

    static func color(_ nivel: NivelSemaforo) -> Color {
        switch nivel {
        case .bueno: return bueno
        case .caro: return caro
        case .normal: return .secondary
        case .sinDatos: return .secondary
        }
    }
}

/// Semáforo de precio frente a tu memoria (semaforoPrecio de web/data/ahorro.js).
struct SemaforoChip: View {
    let semaforo: Semaforo
    var detalle = false

    var body: some View {
        if semaforo.nivel != .sinDatos {
            let color = Estilo.color(semaforo.nivel)
            HStack(spacing: 4) {
                Circle().fill(color).frame(width: 7, height: 7)
                Text(detalle ? semaforo.texto : titulo)
                    .lineLimit(detalle ? 3 : 1)
            }
            .font(.caption.weight(.semibold))
            .foregroundStyle(semaforo.nivel == .normal ? Color.secondary : color)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(color.opacity(0.12), in: Capsule())
            .accessibilityLabel("\(titulo). \(semaforo.texto)")
        }
    }

    private var titulo: String {
        switch semaforo.nivel {
        case .bueno: return "Buen precio"
        case .caro: return "Caro para ti"
        case .normal: return "Normal"
        case .sinDatos: return ""
        }
    }
}

/// Barra de presupuesto: gris lo estimado, de color lo que ya está en el carrito.
struct BarraPresupuesto: View {
    let estimado: Double
    let enCarrito: Double
    let presupuesto: Double

    private var proporcionEstimado: Double { min(1, estimado / max(presupuesto, 0.01)) }
    private var proporcionCarrito: Double { min(1, enCarrito / max(presupuesto, 0.01)) }
    private var color: Color {
        if estimado > presupuesto { return Estilo.caro }
        if estimado > presupuesto * 0.9 { return Estilo.aviso }
        return Estilo.bueno
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color(.tertiarySystemFill))
                    Capsule().fill(Color(.systemGray3)).frame(width: geo.size.width * proporcionEstimado)
                    Capsule().fill(color).frame(width: geo.size.width * proporcionCarrito)
                }
            }
            .frame(height: 8)
            HStack {
                Text("\(Formato.precio(estimado)) de \(Formato.precio(presupuesto))")
                Spacer()
                if estimado > presupuesto {
                    Text("Te pasas \(Formato.precio(estimado - presupuesto))").foregroundStyle(Estilo.caro)
                } else {
                    Text("Quedan \(Formato.precio(presupuesto - estimado))")
                }
            }
            .font(.caption.monospacedDigit())
            .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
    }
}

struct TarjetaKPI: View {
    let titulo: String
    let valor: String
    var detalle: String? = nil
    var simbolo: String
    var color: Color = .accentColor

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(titulo, systemImage: simbolo)
                .font(.caption.weight(.semibold))
                .foregroundStyle(color)
            Text(valor)
                .font(.title2.weight(.bold).monospacedDigit())
                .minimumScaleFactor(0.7)
                .lineLimit(1)
            if let d = detalle {
                Text(d).font(.caption).foregroundStyle(.secondary).lineLimit(2)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

/// Lo que escribe Apple Intelligence siempre lleva ✦.
struct NotaIA: View {
    let nota: AppleIA.Nota

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Label(nota.titulo, systemImage: "sparkles")
                .font(.subheadline.weight(.semibold))
            Text(nota.texto)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
        .accessibilityLabel("Apple Intelligence: \(nota.titulo). \(nota.texto)")
    }
}

/// Fila de consejo del motor de ahorro, con su acción.
struct ConsejoFila: View {
    let consejo: Consejo
    let alTocar: (Consejo) -> Void

    var body: some View {
        Button { alTocar(consejo) } label: {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: consejo.simbolo)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(consejo.tipo == "caro" ? Estilo.caro : Estilo.marca)
                    .frame(width: 28)
                VStack(alignment: .leading, spacing: 3) {
                    Text(consejo.titulo).font(.subheadline.weight(.semibold)).foregroundStyle(.primary)
                    Text(consejo.texto).font(.footnote).foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
                if consejo.accion != nil {
                    Image(systemName: consejo.accion?.agregar != nil ? "plus.circle" : "chevron.right")
                        .foregroundStyle(.tertiary)
                }
            }
            .padding(.vertical, 2)
        }
        .buttonStyle(.plain)
    }
}

/// Chip para agregar con un toque lo que te toca reponer.
struct SugerenciaChip: View {
    let sugerencia: Frecuente
    let alTocar: () -> Void

    var body: some View {
        Button(action: alTocar) {
            VStack(alignment: .leading, spacing: 2) {
                Label(sugerencia.nombre, systemImage: sugerencia.toca ? "clock.badge.exclamationmark" : "plus")
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
                if let m = sugerencia.motivo {
                    Text(m).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .frame(maxWidth: 220, alignment: .leading)
            .background(Color(.tertiarySystemFill), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}

/// Campo numérico compacto con teclado decimal.
struct CampoNumero: View {
    let titulo: String
    @Binding var texto: String
    var prefijo: String? = nil

    var body: some View {
        HStack(spacing: 2) {
            if let p = prefijo { Text(p).foregroundStyle(.secondary) }
            TextField(titulo, text: $texto)
                .keyboardType(.decimalPad)
                .autocorrectionDisabled()
        }
        .font(.body.monospacedDigit())
        .padding(.horizontal, 10)
        .frame(minHeight: 40)
        .background(Color(.tertiarySystemFill), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}

/// Selector de unidad (g, kg, ml, L, u) como menú.
struct SelectorUnidad: View {
    @Binding var unidad: UnidadEntrada

    var body: some View {
        Menu {
            Picker("Unidad", selection: $unidad) {
                ForEach(UnidadEntrada.allCases) { Text($0.etiqueta).tag($0) }
            }
        } label: {
            HStack(spacing: 3) {
                Text(unidad.etiqueta)
                Image(systemName: "chevron.up.chevron.down").font(.caption2)
            }
            .font(.body.weight(.medium))
            .padding(.horizontal, 10)
            .frame(minWidth: 52, minHeight: 40)
            .background(Color(.tertiarySystemFill), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
        .accessibilityLabel("Unidad: \(unidad.etiqueta)")
    }
}

/// Precio de un item según su estado: "~$1.25" estimado, "$1.25 ✓" visto en tienda.
struct PrecioItem: View {
    let item: Item

    var body: some View {
        let total = item.precioVigente * item.piezas
        VStack(alignment: .trailing, spacing: 2) {
            HStack(spacing: 3) {
                if item.estadoPrecio == EstadoPrecio.estimado.rawValue { Text("~").foregroundStyle(.secondary) }
                Text(Formato.precio(total)).font(.body.weight(.semibold).monospacedDigit())
                if item.estadoPrecio == EstadoPrecio.verificadoEnTienda.rawValue {
                    Image(systemName: "checkmark.seal.fill").font(.caption).foregroundStyle(.blue)
                } else if item.estadoPrecio == EstadoPrecio.facturado.rawValue {
                    Image(systemName: "receipt").font(.caption).foregroundStyle(Estilo.marca)
                }
            }
            if item.piezas > 1 {
                Text("\(Formato.numero(item.piezas)) × \(Formato.precio(item.precioVigente))")
                    .font(.caption2.monospacedDigit()).foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

enum Teclado {
    @MainActor
    static func ocultar() {
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
    }
}
