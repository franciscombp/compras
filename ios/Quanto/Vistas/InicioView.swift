import SwiftUI

/// Inicio: la lista activa con su presupuesto, el escáner a un toque, lo que
/// te toca reponer y los consejos del motor de ahorro.
struct InicioView: View {
    @Environment(Datos.self) private var datos
    @Environment(Navegacion.self) private var navegacion
    @State private var ajustes = false
    @State private var agregados = 0

    var body: some View {
        let listaId = datos.listaActivaId()
        let lista = datos.lista(listaId)
        let t = datos.totales(listaId)
        let sugerencias = datos.sugerencias(listaId, limite: 8)
        let consejos = datos.consejos(listaId: listaId, limite: 3)
        let resumen = datos.resumen()

        NavigationStack {
            List {
                Section {
                    HStack(spacing: 12) {
                        AccionGrande(titulo: "Escanear estante", detalle: "Compara varias etiquetas", simbolo: "viewfinder", destacada: true) {
                            navegacion.abrirEscaner()
                        }
                        AccionGrande(titulo: "Comparar", detalle: "Por 100 g o 100 ml", simbolo: "scalemass") {
                            navegacion.pestana = .comparar
                        }
                    }
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
                }

                if let l = lista {
                    Section("Tu lista") {
                        Button { navegacion.abrirLista(l.id) } label: {
                            VStack(alignment: .leading, spacing: 8) {
                                HStack {
                                    Text(l.nombre).font(.headline).foregroundStyle(.primary)
                                    Spacer()
                                    Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
                                }
                                HStack(alignment: .firstTextBaseline) {
                                    Text(Formato.precio(t.totalEstimado))
                                        .font(.title.weight(.bold).monospacedDigit())
                                        .foregroundStyle(.primary)
                                    Text("\(t.countActivos) productos · \(t.countEnCarrito) en el carrito")
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                                if let p = l.presupuesto, p > 0 {
                                    BarraPresupuesto(estimado: t.totalEstimado, enCarrito: t.totalVerificado, presupuesto: p)
                                }
                            }
                            .padding(.vertical, 4)
                        }
                    }
                }

                if !sugerencias.isEmpty {
                    Section {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 8) {
                                ForEach(sugerencias) { s in
                                    SugerenciaChip(sugerencia: s) {
                                        datos.agregar(.init(nombre: s.nombre, cantidad: 1, precio: s.precioRef, contenido: s.contenido,
                                                            unidad: s.unidad, fuente: "sugerencia", listaId: listaId))
                                        agregados += 1
                                    }
                                }
                            }
                            .padding(.vertical, 4)
                        }
                        .listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16))
                    } header: {
                        Text("Te toca reponer")
                    } footer: {
                        Text("Toca uno para agregarlo a tu lista.")
                    }
                }

                if !consejos.isEmpty {
                    Section("Para gastar menos") {
                        ForEach(consejos) { c in
                            ConsejoFila(consejo: c) { aplicar($0, listaId: listaId) }
                        }
                    }
                }

                if let r = resumen, r.compras > 0 {
                    Section("Este mes") {
                        HStack(spacing: 10) {
                            TarjetaKPI(titulo: "Gastado", valor: Formato.precio(r.gastoMes),
                                       detalle: r.variacionMes.map { "\($0 > 0 ? "+" : "−")\(Formato.porcentaje($0)) vs. mes pasado" },
                                       simbolo: "cart")
                            TarjetaKPI(titulo: "Ahorrado", valor: Formato.precio(r.ahorroComparando),
                                       detalle: "comparando antes de elegir", simbolo: "arrow.down.circle", color: Estilo.bueno)
                        }
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                    }
                }
            }
            .navigationTitle("Quanto")
            .sensoryFeedback(.success, trigger: agregados)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { ajustes = true } label: { Image(systemName: "gearshape") }
                        .accessibilityLabel("Ajustes")
                }
            }
            .sheet(isPresented: $ajustes) { AjustesView().entorno() }
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

struct AccionGrande: View {
    let titulo: String
    let detalle: String
    let simbolo: String
    var destacada = false
    let accion: () -> Void

    var body: some View {
        Button(action: accion) {
            VStack(alignment: .leading, spacing: 10) {
                Image(systemName: simbolo)
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(destacada ? Color.white : Estilo.marca)
                VStack(alignment: .leading, spacing: 2) {
                    Text(titulo).font(.headline)
                    Text(detalle).font(.caption).opacity(0.8)
                }
                .foregroundStyle(destacada ? Color.white : Color.primary)
            }
            .frame(maxWidth: .infinity, minHeight: 96, alignment: .topLeading)
            .padding(14)
            .background(destacada ? AnyShapeStyle(Estilo.marca.gradient) : AnyShapeStyle(Color(.secondarySystemGroupedBackground)),
                        in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}
