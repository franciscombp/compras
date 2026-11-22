import SwiftUI

/// Una lista: por comprar, en el carrito y aplazados. Tocar el círculo pone
/// el producto en el carrito; si su precio no se vio en tienda, primero lo
/// pide (así la memoria de precios aprende en la góndola).
struct ListaDetalleView: View {
    let listaId: String
    @Environment(Datos.self) private var datos
    @Environment(Navegacion.self) private var navegacion
    @State private var agregando = false
    @State private var nombreInicial = ""
    @State private var editando: Item?
    @State private var pidiendoPrecio: Item?
    @State private var alCarritoTrasPrecio = false
    @State private var precioTexto = ""
    @State private var editandoLista = false
    @State private var cerrando = false
    @State private var trayendo: PendientesRecordatorios?
    @State private var mensaje: String?
    @State private var toque = 0

    var body: some View {
        let lista = datos.lista(listaId)
        let activa = lista?.activa ?? false
        let items = datos.items(listaId)
        let t = datos.totales(listaId)
        let porComprar = items.filter { !$0.enCarrito && !$0.aplazado }
        let enCarrito = items.filter(\.enCarrito)
        let aplazados = items.filter(\.aplazado)

        List {
            Section { encabezado(lista, t) }

            if items.isEmpty {
                Section {
                    ContentUnavailableView {
                        Label("Lista vacía", systemImage: "cart")
                    } description: {
                        Text("Agrega productos con + o desde el comparador.")
                    }
                }
            }
            if !porComprar.isEmpty {
                Section("Por comprar · \(porComprar.count)") { ForEach(porComprar) { fila($0, activa: activa) } }
            }
            if !enCarrito.isEmpty {
                Section("En el carrito · \(enCarrito.count)") { ForEach(enCarrito) { fila($0, activa: activa) } }
            }
            if !aplazados.isEmpty {
                Section("Para otro día") { ForEach(aplazados) { fila($0, activa: activa) } }
            }
            if activa {
                let sugerencias = datos.sugerencias(listaId, limite: 6)
                if !sugerencias.isEmpty {
                    Section("Sueles llevar") {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 8) {
                                ForEach(sugerencias) { s in
                                    SugerenciaChip(sugerencia: s) { agregarSugerido(s) }
                                }
                            }
                            .padding(.vertical, 4)
                        }
                        .listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16))
                    }
                }
            }
        }
        .navigationTitle(lista?.nombre ?? "Lista")
        .toolbar { if activa, let l = lista { barra(l, items: items) } }
        .safeAreaInset(edge: .bottom) {
            if activa && t.countEnCarrito > 0 {
                Button { cerrando = true } label: {
                    Label("Cerrar compra · \(Formato.precio(t.totalVerificado))", systemImage: "checkmark.circle")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 6)
                }
                .buttonStyle(.borderedProminent)
                .padding(.horizontal)
                .padding(.bottom, 8)
                .background(.bar)
            }
        }
        .sensoryFeedback(.selection, trigger: toque)
        .sheet(isPresented: $agregando) { AgregarItemView(listaId: listaId, nombreInicial: nombreInicial).entorno() }
        .sheet(item: $editando) { EditarItemView(item: $0, soloLectura: !activa).entorno() }
        .sheet(isPresented: $editandoLista) { ListaFormView(lista: lista).entorno() }
        .sheet(isPresented: $cerrando) { CerrarCompraView(listaId: listaId).entorno() }
        .sheet(item: $trayendo) {
            ImportarRecordatoriosView(listaId: listaId, pendientes: $0.items).entorno()
        }
        .alert("¿Cuánto cuesta en la góndola?", isPresented: Binding(get: { pidiendoPrecio != nil }, set: { if !$0 { pidiendoPrecio = nil } }), presenting: pidiendoPrecio) { item in
            TextField("Precio", text: $precioTexto).keyboardType(.decimalPad)
            Button(alCarritoTrasPrecio ? "Al carrito" : "Guardar") { confirmarPrecio(item) }
            Button("Cancelar", role: .cancel) {}
        } message: { item in
            Text("\(item.nombre): el precio que ves en la etiqueta queda en tu memoria de precios.")
        }
        .alert(mensaje ?? "", isPresented: Binding(get: { mensaje != nil }, set: { if !$0 { mensaje = nil } })) {
            Button("OK") {}
        }
    }

    // MARK: - Partes

    @ViewBuilder
    private func encabezado(_ lista: Lista?, _ t: Totales) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(lista?.activa == false ? "Pagaste" : "Estimado").font(.caption).foregroundStyle(.secondary)
                    Text(Formato.precio(lista?.activa == false ? (lista?.totalFacturadoFinal ?? t.totalEstimado) : t.totalEstimado))
                        .font(.largeTitle.weight(.bold).monospacedDigit())
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Text("Visto en tienda").font(.caption).foregroundStyle(.secondary)
                    Text(Formato.precio(t.totalVerificado)).font(.title3.weight(.semibold).monospacedDigit())
                }
            }
            if let p = lista?.presupuesto, p > 0, lista?.activa == true {
                BarraPresupuesto(estimado: t.totalEstimado, enCarrito: t.totalVerificado, presupuesto: p)
            }
            if let d = lista?.diferenciaVsVerificado, lista?.activa == false {
                Label(d <= 0 ? "Pagaste \(Formato.precio(-d)) menos de lo visto en góndola" : "Pagaste \(Formato.precio(d)) más de lo visto en góndola",
                      systemImage: d <= 0 ? "arrow.down.circle.fill" : "arrow.up.circle.fill")
                    .font(.subheadline)
                    .foregroundStyle(d <= 0 ? Estilo.bueno : Estilo.caro)
            }
            if let tienda = lista?.comercioPrincipal, !tienda.isEmpty {
                Label(tienda, systemImage: "storefront").font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 4)
    }

    private func fila(_ it: Item, activa: Bool) -> some View {
        ItemFila(item: it, semaforo: datos.semaforo(de: it), activa: activa,
                 alMarcar: { marcar(it) }, alTocar: { editando = it })
            .swipeActions(edge: .trailing) {
                if activa {
                    Button(role: .destructive) { datos.eliminarItem(it.id) } label: { Label("Eliminar", systemImage: "trash") }
                    if it.aplazado {
                        Button { datos.reactivar(it.id) } label: { Label("Hoy", systemImage: "arrow.uturn.backward") }.tint(.blue)
                    } else {
                        Button { datos.aplazar(it.id) } label: { Label("Otro día", systemImage: "clock") }.tint(.orange)
                    }
                }
            }
            .swipeActions(edge: .leading) {
                if activa && !it.aplazado {
                    Button { pedirPrecio(it, alCarrito: false) } label: { Label("Precio", systemImage: "tag") }.tint(.blue)
                }
            }
    }

    @ToolbarContentBuilder
    private func barra(_ lista: Lista, items: [Item]) -> some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            Menu {
                Button { editandoLista = true } label: { Label("Nombre, tienda y presupuesto", systemImage: "pencil") }
                if lista.id != datos.listaActivaId() {
                    Button { datos.activar(lista.id) } label: { Label("Usar como lista activa", systemImage: "star") }
                }
                Divider()
                Button { Task { await enviarARecordatorios(lista, items: items) } } label: {
                    Label("Enviar a Recordatorios", systemImage: "checklist")
                }
                Button { Task { await traerDeRecordatorios(lista) } } label: {
                    Label("Traer de Recordatorios", systemImage: "square.and.arrow.down")
                }
                ShareLink(item: texto(lista, items: items)) { Label("Compartir lista", systemImage: "square.and.arrow.up") }
                Divider()
                Button { datos.duplicar(lista.id) } label: { Label("Duplicar", systemImage: "plus.square.on.square") }
                Button { cerrando = true } label: { Label("Cerrar compra", systemImage: "checkmark.circle") }
            } label: {
                Image(systemName: "ellipsis.circle")
            }
            .accessibilityLabel("Opciones de la lista")
        }
        ToolbarItem(placement: .topBarTrailing) {
            Button { nombreInicial = ""; agregando = true } label: { Image(systemName: "plus") }
                .accessibilityLabel("Agregar producto")
        }
    }

    // MARK: - Acciones

    private func marcar(_ it: Item) {
        toque += 1
        if it.enCarrito {
            datos.alCarrito(it.id, false)
        } else if !datos.alCarrito(it.id, true) {
            pedirPrecio(it, alCarrito: true)
        }
    }

    private func pedirPrecio(_ it: Item, alCarrito: Bool) {
        alCarritoTrasPrecio = alCarrito
        precioTexto = Formato.texto(it.precioVigente > 0 ? it.precioVigente : nil)
        pidiendoPrecio = it
    }

    private func confirmarPrecio(_ it: Item) {
        guard let p = Formato.leerNumero(precioTexto), p > 0 else { return }
        datos.verificar(it.id, precio: p)
        if alCarritoTrasPrecio { datos.alCarrito(it.id, true) }
    }

    private func agregarSugerido(_ s: Frecuente) {
        datos.agregar(.init(nombre: s.nombre, cantidad: 1, precio: s.precioRef, contenido: s.contenido, unidad: s.unidad,
                            fuente: "sugerencia", listaId: listaId))
        toque += 1
    }

    private func nota(_ i: Item) -> String {
        let precio = i.precioVerificado ?? i.precioEstimado ?? 0
        return [i.piezas > 1 ? "×\(Formato.numero(i.piezas))" : nil,
                Formato.contenido(i.contenido, i.unidadMedida),
                precio > 0 ? "~\(Formato.precio(precio))" : nil].compactMap { $0 }.joined(separator: " · ")
    }

    private func texto(_ lista: Lista, items: [Item]) -> String {
        let lineas = items.filter { !$0.aplazado }.map { i -> String in
            let n = nota(i)
            return "• \(i.nombre)\(n.isEmpty ? "" : " (\(n))")"
        }
        return "\(lista.nombre)\n\(lineas.joined(separator: "\n"))\n\nEstimado: \(Formato.precio(datos.totales(lista.id).totalEstimado))\nHecho con Quanto"
    }

    private func enviarARecordatorios(_ lista: Lista, items: [Item]) async {
        let pendientes = items.filter { !$0.aplazado && !$0.enCarrito }
        guard !pendientes.isEmpty else { mensaje = "No hay nada por comprar en la lista."; return }
        do {
            let r = try await Recordatorios.exportar(lista: lista.nombre, items: pendientes.map {
                Recordatorios.Item(nombre: $0.nombre, nota: nota($0).isEmpty ? nil : nota($0))
            })
            mensaje = r.creados > 0
                ? "\(r.creados) \(r.creados == 1 ? "producto enviado" : "productos enviados") a Recordatorios en «\(lista.nombre)»\(r.omitidos > 0 ? " (\(r.omitidos) ya estaban)" : "")."
                : "Todo ya estaba en Recordatorios."
        } catch Recordatorios.Fallo.sinPermiso {
            mensaje = "Permite el acceso a Recordatorios en Ajustes > Quanto."
        } catch {
            mensaje = "No se pudo hablar con Recordatorios."
        }
    }

    private func traerDeRecordatorios(_ lista: Lista) async {
        do {
            let pendientes = try await Recordatorios.pendientes(lista: lista.nombre)
            if pendientes.isEmpty { mensaje = "No hay pendientes en Recordatorios." } else { trayendo = PendientesRecordatorios(items: pendientes) }
        } catch Recordatorios.Fallo.sinPermiso {
            mensaje = "Permite el acceso a Recordatorios en Ajustes > Quanto."
        } catch {
            mensaje = "No se pudo hablar con Recordatorios."
        }
    }
}

private struct PendientesRecordatorios: Identifiable {
    let id = UUID()
    let items: [Recordatorios.Item]
}

/// Fila de un producto en la lista.
struct ItemFila: View {
    let item: Item
    let semaforo: Semaforo
    let activa: Bool
    let alMarcar: () -> Void
    let alTocar: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            if activa && !item.aplazado {
                Button(action: alMarcar) {
                    Image(systemName: item.enCarrito ? "checkmark.circle.fill" : "circle")
                        .font(.title2)
                        .foregroundStyle(item.enCarrito ? Estilo.bueno : Color.secondary)
                        .contentTransition(.symbolEffect(.replace))
                }
                .buttonStyle(.borderless)
                .accessibilityLabel(item.enCarrito ? "Sacar del carrito" : "Poner en el carrito")
            }
            Button(action: alTocar) {
                HStack(spacing: 8) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(item.nombre)
                            .strikethrough(item.enCarrito, color: .secondary)
                            .foregroundStyle(item.enCarrito || item.aplazado ? Color.secondary : Color.primary)
                        HStack(spacing: 6) {
                            if let d = detalle { Text(d).font(.caption).foregroundStyle(.secondary) }
                            SemaforoChip(semaforo: semaforo)
                        }
                    }
                    Spacer(minLength: 4)
                    PrecioItem(item: item)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .padding(.vertical, 2)
    }

    private var detalle: String? {
        var partes: [String] = []
        if let c = Formato.contenido(item.contenido, item.unidadMedida) { partes.append(c) }
        if let c = item.contenido, c > 0, item.precioVigente > 0 {
            let n = item.unidadMedida == "unidad" ? item.precioVigente / c : item.precioVigente / c * 100
            partes.append("\(Formato.normalizado(n))/\(Formato.base(item.unidadMedida))")
        }
        if let m = item.motivoAplazado, !m.isEmpty { partes.append(m) }
        return partes.isEmpty ? nil : partes.joined(separator: " · ")
    }
}
