import SwiftUI

/// Todas las listas: las activas arriba, las compras cerradas abajo.
struct ListasView: View {
    @Environment(Datos.self) private var datos
    @Environment(Navegacion.self) private var navegacion
    @State private var creando = false

    var body: some View {
        @Bindable var nav = navegacion
        let activaId = datos.listaActivaId()
        let activas = datos.listasActivas()
        let cerradas = datos.historial()
        NavigationStack(path: $nav.rutaListas) {
            List {
                Section("Activas") {
                    ForEach(activas) { lista in
                        NavigationLink(value: lista.id) {
                            FilaLista(lista: lista, totales: datos.totales(lista.id), esActiva: lista.id == activaId)
                        }
                        .swipeActions(edge: .leading) {
                            if lista.id != activaId {
                                Button { datos.activar(lista.id) } label: { Label("Usar", systemImage: "star") }.tint(.yellow)
                            }
                        }
                        .swipeActions(edge: .trailing) {
                            Button { datos.duplicar(lista.id) } label: { Label("Duplicar", systemImage: "plus.square.on.square") }
                        }
                    }
                }
                if !cerradas.isEmpty {
                    Section("Compras cerradas") {
                        ForEach(cerradas.prefix(20)) { lista in
                            NavigationLink(value: lista.id) { FilaCompraCerrada(lista: lista) }
                        }
                    }
                }
            }
            .navigationTitle("Listas")
            .navigationDestination(for: String.self) { ListaDetalleView(listaId: $0) }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { creando = true } label: { Image(systemName: "plus") }
                        .accessibilityLabel("Nueva lista")
                }
            }
            .sheet(isPresented: $creando) { ListaFormView(lista: nil).entorno() }
        }
    }
}

struct FilaLista: View {
    let lista: Lista
    let totales: Totales
    let esActiva: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                if esActiva { Image(systemName: "star.fill").foregroundStyle(.yellow).font(.caption) }
                Text(lista.nombre).font(.headline)
                Spacer()
                Text(Formato.precio(totales.totalEstimado)).font(.subheadline.monospacedDigit()).foregroundStyle(.secondary)
            }
            Text(detalle).font(.caption).foregroundStyle(.secondary)
            if let p = lista.presupuesto, p > 0 {
                BarraPresupuesto(estimado: totales.totalEstimado, enCarrito: totales.totalVerificado, presupuesto: p)
            }
        }
        .padding(.vertical, 2)
    }

    private var detalle: String {
        var partes = ["\(totales.countActivos) \(totales.countActivos == 1 ? "producto" : "productos")"]
        if totales.countEnCarrito > 0 { partes.append("\(totales.countEnCarrito) en el carrito") }
        if let t = lista.comercioPrincipal, !t.isEmpty { partes.append(t) }
        return partes.joined(separator: " · ")
    }
}

struct FilaCompraCerrada: View {
    let lista: Lista

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(lista.nombre)
                Text([Formato.fecha(lista.fecha), lista.comercioPrincipal].compactMap { $0 }.joined(separator: " · "))
                    .font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text(Formato.precio(lista.totalFacturadoFinal)).font(.body.weight(.semibold).monospacedDigit())
                if let d = lista.diferenciaVsVerificado, abs(d) >= 0.01 {
                    Text(d < 0 ? "−\(Formato.precio(-d)) vs. góndola" : "+\(Formato.precio(d)) vs. góndola")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(d < 0 ? Estilo.bueno : Estilo.caro)
                }
            }
        }
    }
}

/// Crear o editar una lista: nombre, tienda y presupuesto.
struct ListaFormView: View {
    let lista: Lista?
    @Environment(Datos.self) private var datos
    @Environment(Navegacion.self) private var navegacion
    @Environment(\.dismiss) private var dismiss
    @State private var nombre = ""
    @State private var tienda = ""
    @State private var presupuesto = ""
    @State private var listo = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Nombre (ej.: Súper del sábado)", text: $nombre)
                    TextField("Tienda (ej.: Supermaxi)", text: $tienda)
                        .textInputAutocapitalization(.words)
                } footer: {
                    Text("La tienda se usa para tu memoria de precios: así Quanto sabe dónde viste cada precio.")
                }
                Section {
                    HStack {
                        Text("Presupuesto")
                        Spacer()
                        TextField("Sin presupuesto", text: $presupuesto)
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                            .frame(maxWidth: 160)
                    }
                }
            }
            .navigationTitle(lista == nil ? "Nueva lista" : "Editar lista")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancelar") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button(lista == nil ? "Crear" : "Guardar") { guardar() } }
            }
            .onAppear {
                guard !listo else { return }
                listo = true
                let a = datos.ajustes()
                nombre = lista?.nombre ?? ""
                tienda = lista?.comercioPrincipal ?? a.tiendaHabitual ?? ""
                presupuesto = Formato.texto(lista?.presupuesto ?? (lista == nil ? a.presupuestoDefecto : nil))
            }
        }
    }

    private func guardar() {
        let p = Formato.leerNumero(presupuesto)
        if let l = lista {
            datos.editarLista(l.id, nombre: nombre, tienda: tienda, presupuesto: p)
        } else if let nueva = datos.crearLista(nombre: nombre, tienda: tienda, presupuesto: p) {
            navegacion.abrirLista(nueva.id)
        }
        dismiss()
    }
}
