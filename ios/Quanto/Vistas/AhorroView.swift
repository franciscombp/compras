import SwiftUI
import Charts

struct ProductoRuta: Hashable {
    let nombre: String
}

/// Guía de ahorro: Resumen (números, coach, consejos, tiendas), Precios
/// (memoria por producto) y Compras (historial cerrado).
struct AhorroView: View {
    enum Seccion: String, CaseIterable, Identifiable {
        case resumen = "Resumen", precios = "Precios", compras = "Compras"
        var id: String { rawValue }
    }

    @State private var seccion: Seccion = .resumen

    var body: some View {
        NavigationStack {
            Group {
                switch seccion {
                case .resumen: ResumenAhorroView()
                case .precios: PreciosView()
                case .compras: ComprasView()
                }
            }
            .safeAreaInset(edge: .top, spacing: 0) {
                Picker("Sección", selection: $seccion) {
                    ForEach(Seccion.allCases) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal)
                .padding(.bottom, 8)
                .background(.bar)
            }
            .navigationTitle("Ahorro")
            .navigationDestination(for: String.self) { ListaDetalleView(listaId: $0) }
            .navigationDestination(for: ProductoRuta.self) { PrecioDetalleView(nombre: $0.nombre) }
        }
    }
}

// MARK: - Resumen

struct ResumenAhorroView: View {
    @Environment(Datos.self) private var datos
    @Environment(Navegacion.self) private var navegacion
    @State private var coach: AppleIA.Nota?
    @State private var agregados = 0

    private static var coachCache: [String: AppleIA.Nota] = [:]

    var body: some View {
        let listaId = datos.listaActivaId()
        if let r = datos.resumen(), r.compras > 0 || r.observaciones > 0 {
            let consejos = datos.consejos(listaId: listaId, limite: 5)
            let textoCoach = AppleIA.disponible() ? datos.textoCoach(listaId: listaId) : ""
            List {
                Section {
                    LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                        TarjetaKPI(titulo: "Este mes", valor: Formato.precio(r.gastoMes),
                                   detalle: r.variacionMes.map { "\($0 > 0 ? "+" : "−")\(Formato.porcentaje($0)) vs. el anterior" } ?? "\(r.comprasMes) compras",
                                   simbolo: "calendar")
                        TarjetaKPI(titulo: "Ticket promedio", valor: Formato.precio(r.ticketPromedio),
                                   detalle: "\(r.compras) compras cerradas", simbolo: "cart")
                        TarjetaKPI(titulo: "Ahorrado comparando", valor: Formato.precio(r.ahorroComparando),
                                   detalle: "en \(r.comparacionesConAhorro) comparaciones", simbolo: "arrow.down.circle", color: Estilo.bueno)
                        TarjetaKPI(titulo: "Góndola vs. caja", valor: Formato.precio(r.masQueVerificado - r.menosQueVerificado),
                                   detalle: r.masQueVerificado > r.menosQueVerificado ? "pagado de más en caja" : "a tu favor",
                                   simbolo: "receipt", color: r.masQueVerificado > r.menosQueVerificado + 0.5 ? Estilo.caro : Estilo.bueno)
                    }
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
                }

                if let c = coach {
                    Section("Tu coach") { NotaIA(nota: c) }
                }

                if !consejos.isEmpty {
                    Section("Consejos") {
                        ForEach(consejos) { c in
                            ConsejoFila(consejo: c) { aplicar($0, listaId: listaId) }
                        }
                    }
                }

                if !r.tiendas.isEmpty {
                    Section {
                        ForEach(r.tiendas) { t in
                            VStack(alignment: .leading, spacing: 6) {
                                HStack {
                                    Text(t.tienda).font(.subheadline.weight(.semibold))
                                    Spacer()
                                    Text("gana \(t.gana) de \(t.compara)").font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                                }
                                ProgressView(value: t.ratio).tint(t.ratio >= 0.6 ? Estilo.bueno : .secondary)
                                if let e = t.ejemplos.first {
                                    Text("\(e.nombre): \(e.pct)% menos que en \(e.vs)").font(.caption).foregroundStyle(.secondary)
                                }
                            }
                            .padding(.vertical, 2)
                        }
                    } header: {
                        Text("Tiendas")
                    } footer: {
                        Text("Entre los productos que viste en más de una tienda.")
                    }
                }

                if !r.topGasto.isEmpty {
                    Section("En qué se te va (90 días)") {
                        Chart(r.topGasto) { g in
                            BarMark(x: .value("Gasto", g.gasto), y: .value("Producto", g.nombre))
                                .foregroundStyle(Estilo.marca.gradient)
                                .annotation(position: .trailing) {
                                    Text(Formato.porcentaje(g.pct)).font(.caption2.monospacedDigit()).foregroundStyle(.secondary)
                                }
                        }
                        .chartXAxis(.hidden)
                        .frame(height: CGFloat(r.topGasto.count) * 36 + 8)
                        .padding(.vertical, 6)
                    }
                }

                if !r.frecuentes.isEmpty {
                    Section("Lo que más compras") {
                        ForEach(r.frecuentes) { f in
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(f.nombre)
                                    Text(f.intervaloDias.map { "cada \($0) días · \(f.veces) compras" } ?? "\(f.veces) compras")
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                                if f.toca {
                                    Button {
                                        datos.agregar(.init(nombre: f.nombre, fuente: "sugerencia", listaId: listaId))
                                        agregados += 1
                                    } label: {
                                        Label("Toca", systemImage: "plus.circle.fill").font(.caption.weight(.semibold))
                                    }
                                    .buttonStyle(.bordered)
                                    .tint(Estilo.marca)
                                }
                            }
                        }
                    }
                }
            }
            .sensoryFeedback(.success, trigger: agregados)
            .task(id: textoCoach) { await pedirCoach(textoCoach) }
        } else {
            ContentUnavailableView {
                Label("Tu guía de ahorro empieza aquí", systemImage: "chart.line.downtrend.xyaxis")
            } description: {
                Text("Escanea etiquetas, verifica precios en la góndola o cierra tu primera compra: Quanto aprende tus precios y te dice dónde ahorrar.")
            } actions: {
                Button("Escanear el estante") { navegacion.abrirEscaner() }
                    .buttonStyle(.borderedProminent)
            }
        }
    }

    private func pedirCoach(_ texto: String) async {
        guard !texto.isEmpty else { coach = nil; return }
        if let c = Self.coachCache[texto] { coach = c; return }
        if let c = try? await AppleIA.consejo(resumen: texto) {
            Self.coachCache[texto] = c
            coach = c
        }
    }

    private func aplicar(_ c: Consejo, listaId: String) {
        if let n = c.accion?.agregar {
            datos.agregar(.init(nombre: n, fuente: "consejo", listaId: listaId))
            agregados += 1
        } else if let destino = c.accion?.goto {
            navegacion.ir(destino)
        }
    }
}

// MARK: - Precios

struct PreciosView: View {
    @Environment(Datos.self) private var datos
    @State private var busqueda = ""

    var body: some View {
        let todos = datos.productosConMemoria()
        let q = busqueda.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: nil)
        let filtrados = q.isEmpty ? todos : todos.filter {
            $0.nombre.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: nil).contains(q)
        }
        Group {
            if todos.isEmpty {
                ContentUnavailableView("Aún no hay precios", systemImage: "tag",
                                       description: Text("Cada precio que ves en la góndola, comparas o pagas queda aquí, por producto y tienda."))
            } else if filtrados.isEmpty {
                ContentUnavailableView.search(text: busqueda)
            } else {
                List(filtrados) { s in
                    NavigationLink(value: ProductoRuta(nombre: s.nombre)) { FilaPrecio(stats: s) }
                }
            }
        }
        .searchable(text: $busqueda, prompt: "Buscar producto")
    }
}

struct FilaPrecio: View {
    let stats: Estadisticas

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(stats.nombre).lineLimit(1)
                Text("mín. \(Formato.normalizado(stats.minimo.valor))\(stats.minimo.tienda.map { " · \($0)" } ?? "")")
                    .font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer(minLength: 4)
            if stats.serie.count > 1 {
                Chart(Array(stats.serie.enumerated()), id: \.offset) { _, p in
                    LineMark(x: .value("Fecha", p.fecha.fechaJS), y: .value("Precio", p.valor))
                        .interpolationMethod(.monotone)
                        .foregroundStyle(tendenciaColor)
                }
                .chartXAxis(.hidden)
                .chartYAxis(.hidden)
                .chartYScale(domain: .automatic(includesZero: false))
                .frame(width: 64, height: 28)
                .accessibilityHidden(true)
            }
            VStack(alignment: .trailing, spacing: 2) {
                HStack(spacing: 3) {
                    if stats.tendencia != 0 {
                        Image(systemName: stats.tendencia > 0 ? "arrow.up.right" : "arrow.down.right")
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(tendenciaColor)
                    }
                    Text(Formato.normalizado(stats.ultimo.valor)).font(.body.weight(.semibold).monospacedDigit())
                }
                Text(stats.base).font(.caption2).foregroundStyle(.secondary)
            }
        }
    }

    private var tendenciaColor: Color {
        stats.tendencia > 0 ? Estilo.caro : stats.tendencia < 0 ? Estilo.bueno : .secondary
    }
}

struct PrecioDetalleView: View {
    let nombre: String
    @Environment(Datos.self) private var datos

    var body: some View {
        if let s = datos.estadisticas(nombre) {
            List {
                Section {
                    Chart {
                        ForEach(Array(s.serie.enumerated()), id: \.offset) { _, p in
                            LineMark(x: .value("Fecha", p.fecha.fechaJS), y: .value("Precio", p.valor))
                                .interpolationMethod(.monotone)
                                .foregroundStyle(Estilo.marca)
                            PointMark(x: .value("Fecha", p.fecha.fechaJS), y: .value("Precio", p.valor))
                                .foregroundStyle(by: .value("Tienda", p.tienda ?? "Sin tienda"))
                        }
                        if let h = s.habitual {
                            RuleMark(y: .value("Habitual", h))
                                .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 4]))
                                .foregroundStyle(.secondary)
                                .annotation(position: .top, alignment: .leading) {
                                    Text("habitual").font(.caption2).foregroundStyle(.secondary)
                                }
                        }
                    }
                    .chartYScale(domain: .automatic(includesZero: false))
                    .frame(height: 200)
                    .padding(.vertical, 8)
                } footer: {
                    Text("Precio \(s.base).")
                }

                Section {
                    LabeledContent("Último", value: "\(Formato.normalizado(s.ultimo.valor)) · \(Formato.precio(s.ultimo.precio))")
                    LabeledContent("Mínimo", value: "\(Formato.normalizado(s.minimo.valor))\(s.minimo.tienda.map { " · \($0)" } ?? "")")
                    if let h = s.habitual { LabeledContent("Habitual", value: Formato.normalizado(h)) }
                    LabeledContent("Precios guardados", value: "\(s.n)")
                }

                if !s.tiendas.isEmpty {
                    Section("Por tienda") {
                        ForEach(s.tiendas, id: \.tienda) { t in
                            HStack {
                                Text(t.tienda)
                                if t.tienda == s.tiendas.first?.tienda && s.tiendas.count > 1 {
                                    Text("más barata").font(.caption2.weight(.semibold)).foregroundStyle(Estilo.bueno)
                                }
                                Spacer()
                                Text(Formato.normalizado(t.mediana)).monospacedDigit()
                            }
                        }
                    }
                }

                Section("Historial") {
                    ForEach(Array(s.serie.reversed().enumerated()), id: \.offset) { _, p in
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(Formato.fecha(p.fecha.fechaJS))
                                Text([p.tienda, fuente(p.fuente)].compactMap { $0 }.joined(separator: " · "))
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            VStack(alignment: .trailing, spacing: 2) {
                                Text(Formato.precio(p.precio)).monospacedDigit()
                                Text(Formato.normalizado(p.valor)).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
            .navigationTitle(s.nombre)
            .navigationBarTitleDisplayMode(.inline)
        } else {
            ContentUnavailableView("Sin precios de \(nombre)", systemImage: "tag")
        }
    }

    private func fuente(_ f: String?) -> String? {
        switch f {
        case "facturado": return "recibo"
        case "verificado": return "góndola"
        case "comparador": return "comparador"
        case "escaner": return "escáner"
        default: return nil
        }
    }
}

// MARK: - Compras

struct ComprasView: View {
    @Environment(Datos.self) private var datos

    var body: some View {
        let historial = datos.historial()
        if historial.isEmpty {
            ContentUnavailableView("Aún no cierras una compra", systemImage: "bag",
                                   description: Text("Al pagar, cierra la lista con el total del recibo: Quanto compara lo pagado con lo visto en góndola."))
        } else {
            List(historial) { l in
                NavigationLink(value: l.id) { FilaCompraCerrada(lista: l) }
            }
        }
    }
}
