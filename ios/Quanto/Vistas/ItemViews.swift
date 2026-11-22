import SwiftUI

/// Agregar un producto: se puede escribir o dictar la frase entera
/// ("2 leches Vita de litro a 1.25") y Apple Intelligence llena los campos.
struct AgregarItemView: View {
    let listaId: String
    var nombreInicial = ""
    @Environment(Datos.self) private var datos
    @Environment(\.dismiss) private var dismiss
    @State private var nombre = ""
    @State private var cantidad = 1
    @State private var precioTexto = ""
    @State private var contenidoTexto = ""
    @State private var unidad: UnidadEntrada = .g
    @State private var visto = false
    @State private var interpretando = false
    @State private var duplicado: Item?
    @State private var listo = false
    @FocusState private var enNombre: Bool

    private var tieneNumeros: Bool { nombre.rangeOfCharacter(from: .decimalDigits) != nil || nombre.split(separator: " ").count >= 4 }
    private var precio: Double? { Formato.leerNumero(precioTexto).flatMap { $0 > 0 ? $0 : nil } }
    private var contenido: Double? { Formato.leerNumero(contenidoTexto).flatMap { $0 > 0 ? $0 * unidad.factor : nil } }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Ej.: 2 leches Vita de litro a 1.25", text: $nombre)
                        .focused($enNombre)
                        .submitLabel(.done)
                        .onSubmit { interpretar() }
                    if AppleIA.disponible() && tieneNumeros {
                        Button { interpretar() } label: {
                            if interpretando {
                                HStack { ProgressView(); Text("Entendiendo…") }
                            } else {
                                Label("Llenar con Apple Intelligence", systemImage: "sparkles")
                            }
                        }
                        .disabled(interpretando)
                    }
                } footer: {
                    Text(AppleIA.disponible()
                         ? "Escribe o dicta la frase completa: cantidad, producto, tamaño y precio."
                         : "Escribe el producto; el tamaño (\"1 L\", \"500 g\") se reconoce solo.")
                }

                let catalogo = tieneNumeros ? [] : Catalogo.buscar(nombre, limite: 4)
                if !catalogo.isEmpty && !catalogo.contains(where: { $0.n == nombre }) {
                    Section("Del catálogo") {
                        ForEach(catalogo) { p in
                            Button { aplicar(p) } label: {
                                HStack {
                                    Text(p.n).foregroundStyle(.primary)
                                    Spacer()
                                    if let c = Formato.contenido(p.c, p.u) { Text(c).foregroundStyle(.secondary) }
                                }
                            }
                        }
                    }
                }

                Section("Detalle") {
                    Stepper("Cantidad: \(cantidad)", value: $cantidad, in: 1...99)
                    HStack {
                        Text("Precio")
                        Spacer()
                        CampoNumero(titulo: "0.00", texto: $precioTexto, prefijo: "$").frame(maxWidth: 140)
                    }
                    HStack {
                        Text("Contenido")
                        Spacer()
                        CampoNumero(titulo: "500", texto: $contenidoTexto).frame(maxWidth: 110)
                        SelectorUnidad(unidad: $unidad)
                    }
                    Toggle("Lo estoy viendo en la góndola", isOn: $visto)
                }

                MemoriaProducto(nombre: nombre, precio: precio, contenido: contenido, unidad: unidad.base)
            }
            .navigationTitle("Agregar producto")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancelar") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Agregar") { guardar(forzar: false) }
                        .disabled(nombre.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .alert("Ya está en la lista", isPresented: Binding(get: { duplicado != nil }, set: { if !$0 { duplicado = nil } }), presenting: duplicado) { it in
                Button("Sumar \(cantidad) a «\(it.nombre)»") {
                    datos.editarItem(it.id, nombre: it.nombre, cantidad: it.piezas + Double(cantidad), precio: it.precioVigente,
                                     contenido: it.contenido, unidad: it.unidadMedida)
                    dismiss()
                }
                Button("Agregar aparte") { guardar(forzar: true) }
                Button("Cancelar", role: .cancel) {}
            }
            .onAppear {
                guard !listo else { return }
                listo = true
                nombre = nombreInicial
                enNombre = nombreInicial.isEmpty
            }
        }
    }

    private func aplicar(_ p: ProductoCatalogo) {
        nombre = p.n
        let (u, c) = UnidadEntrada.desde(contenido: p.c, unidad: p.u)
        unidad = u
        contenidoTexto = Formato.texto(c)
        if let pr = p.p, precioTexto.isEmpty { precioTexto = String(format: "%.2f", pr) }
    }

    /// Frase -> campos. Con Apple Intelligence entiende cantidades y precios
    /// dichos en palabras; sin ella, saca el tamaño del nombre.
    private func interpretar() {
        let frase = nombre.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !frase.isEmpty else { return }
        if AppleIA.disponible() && tieneNumeros {
            interpretando = true
            Task {
                defer { interpretando = false }
                guard let p = try? await AppleIA.producto(frase: frase) else { return }
                if !p.nombre.isEmpty { nombre = p.nombre }
                cantidad = p.cantidad
                if let pr = p.precio { precioTexto = String(format: "%.2f", pr) }
                if let c = p.contenido {
                    let (u, v) = UnidadEntrada.desde(contenido: c, unidad: p.unidad)
                    unidad = u
                    contenidoTexto = Formato.texto(v)
                }
            }
        } else if contenidoTexto.isEmpty, let m = datos.medidaDeNombre(frase), let c = m.contenido {
            let (u, v) = UnidadEntrada.desde(contenido: c, unidad: m.unidad)
            unidad = u
            contenidoTexto = Formato.texto(v)
        }
    }

    private func guardar(forzar: Bool) {
        let n = nombre.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !n.isEmpty else { return }
        if !forzar, let d = datos.itemSimilar(n, en: listaId) { duplicado = d; return }
        datos.agregar(.init(nombre: n, cantidad: Double(cantidad), precio: precio, contenido: contenido, unidad: unidad.base,
                            verificado: visto, fuente: "manual", listaId: listaId))
        dismiss()
    }
}

/// Editar un producto de la lista y ver lo que la memoria sabe de él.
struct EditarItemView: View {
    let item: Item
    var soloLectura = false
    @Environment(Datos.self) private var datos
    @Environment(\.dismiss) private var dismiss
    @State private var nombre = ""
    @State private var cantidad = 1
    @State private var precioTexto = ""
    @State private var contenidoTexto = ""
    @State private var unidad: UnidadEntrada = .g
    @State private var listo = false

    private var precio: Double? { Formato.leerNumero(precioTexto).flatMap { $0 > 0 ? $0 : nil } }
    private var contenido: Double? { Formato.leerNumero(contenidoTexto).flatMap { $0 > 0 ? $0 * unidad.factor : nil } }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Producto", text: $nombre)
                    Stepper("Cantidad: \(cantidad)", value: $cantidad, in: 1...99)
                    HStack {
                        Text(item.estadoPrecio == EstadoPrecio.estimado.rawValue ? "Precio estimado" : "Precio en tienda")
                        Spacer()
                        CampoNumero(titulo: "0.00", texto: $precioTexto, prefijo: "$").frame(maxWidth: 140)
                    }
                    HStack {
                        Text("Contenido")
                        Spacer()
                        CampoNumero(titulo: "500", texto: $contenidoTexto).frame(maxWidth: 110)
                        SelectorUnidad(unidad: $unidad)
                    }
                } footer: {
                    Text(estadoTexto)
                }
                .disabled(soloLectura)

                MemoriaProducto(nombre: nombre, precio: precio, contenido: contenido, unidad: unidad.base)

                if !soloLectura {
                    Section {
                        if item.estadoPrecio == EstadoPrecio.estimado.rawValue, let p = precio {
                            Button { datos.verificar(item.id, precio: p); dismiss() } label: {
                                Label("Lo vi a \(Formato.precio(p)) en la góndola", systemImage: "checkmark.seal")
                            }
                        }
                        Button(role: .destructive) { datos.eliminarItem(item.id); dismiss() } label: {
                            Label("Quitar de la lista", systemImage: "trash")
                        }
                    }
                }
            }
            .navigationTitle(item.nombre)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if soloLectura {
                    ToolbarItem(placement: .confirmationAction) { Button("Listo") { dismiss() } }
                } else {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancelar") { dismiss() } }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Guardar") {
                            datos.editarItem(item.id, nombre: nombre, cantidad: Double(cantidad), precio: precio, contenido: contenido, unidad: unidad.base)
                            dismiss()
                        }
                        .disabled(nombre.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }
            }
            .onAppear {
                guard !listo else { return }
                listo = true
                nombre = item.nombre
                cantidad = Int(item.piezas)
                precioTexto = item.precioVigente > 0 ? String(format: "%.2f", item.precioVigente) : ""
                let (u, c) = UnidadEntrada.desde(contenido: item.contenido, unidad: item.unidadMedida)
                unidad = u
                contenidoTexto = Formato.texto(c)
            }
        }
    }

    private var estadoTexto: String {
        switch item.estadoPrecio {
        case EstadoPrecio.facturado.rawValue: return "Precio del recibo."
        case EstadoPrecio.verificadoEnTienda.rawValue: return "Precio visto en la góndola: puede cambiar en caja por promos."
        default: return "Precio de referencia, aún sin ver en tienda."
        }
    }
}

/// Lo que la memoria sabe de un producto: último, mínimo, habitual y por tienda.
struct MemoriaProducto: View {
    let nombre: String
    let precio: Double?
    let contenido: Double?
    let unidad: String
    @Environment(Datos.self) private var datos

    var body: some View {
        let limpio = nombre.trimmingCharacters(in: .whitespaces)
        if limpio.count >= 3, let s = datos.estadisticas(limpio) {
            let sem = datos.semaforo(nombre: limpio, precio: precio, contenido: contenido, unidad: unidad)
            Section {
                if sem.nivel != .sinDatos {
                    SemaforoChip(semaforo: sem, detalle: true)
                }
                LabeledContent("Última vez", value: "\(Formato.normalizado(s.ultimo.valor)) \(s.base)\(s.ultimo.tienda.map { " · \($0)" } ?? "")")
                LabeledContent("Tu mínimo", value: "\(Formato.normalizado(s.minimo.valor))\(s.minimo.tienda.map { " · \($0)" } ?? "")")
                if let h = s.habitual { LabeledContent("Habitual", value: Formato.normalizado(h)) }
                if s.tiendas.count > 1 {
                    ForEach(s.tiendas, id: \.tienda) { t in
                        LabeledContent(t.tienda, value: "\(Formato.normalizado(t.mediana)) · \(t.n) \(t.n == 1 ? "vez" : "veces")")
                    }
                }
                NavigationLink {
                    PrecioDetalleView(nombre: s.nombre)
                } label: {
                    Label("Ver historial", systemImage: "chart.xyaxis.line")
                }
            } header: {
                Text("Tu memoria · \(s.n) \(s.n == 1 ? "precio" : "precios")")
            }
        }
    }
}

/// Cierra la compra con el total del recibo.
struct CerrarCompraView: View {
    let listaId: String
    @Environment(Datos.self) private var datos
    @Environment(\.dismiss) private var dismiss
    @State private var totalTexto = ""
    @State private var resultado: Lista?
    @State private var listo = false

    var body: some View {
        let t = datos.totales(listaId)
        NavigationStack {
            Form {
                Section {
                    LabeledContent("Estimado", value: Formato.precio(t.totalEstimado))
                    LabeledContent("Visto en góndola", value: Formato.precio(t.totalVerificado))
                    LabeledContent("En el carrito", value: "\(t.countEnCarrito) de \(t.countActivos)")
                }
                Section {
                    HStack {
                        Text("Total del recibo")
                        Spacer()
                        CampoNumero(titulo: "0.00", texto: $totalTexto, prefijo: "$").frame(maxWidth: 150)
                    }
                } footer: {
                    Text("Quanto compara lo que pagaste con lo que viste en la góndola y guarda la compra en tu historial.")
                }
            }
            .navigationTitle("Cerrar compra")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancelar") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Cerrar") { resultado = datos.cerrarCompra(listaId, totalPagado: Formato.leerNumero(totalTexto)) }
                }
            }
            .alert("Compra cerrada", isPresented: Binding(get: { resultado != nil }, set: { if !$0 { resultado = nil; dismiss() } }), presenting: resultado) { _ in
                Button("Listo") {}
            } message: { l in
                let d = l.diferenciaVsVerificado ?? 0
                Text(abs(d) < 0.01 ? "Pagaste lo mismo que viste en la góndola." :
                        d < 0 ? "Pagaste \(Formato.precio(-d)) menos de lo esperado." : "Pagaste \(Formato.precio(d)) más de lo esperado: revisa el recibo.")
            }
            .sensoryFeedback(.success, trigger: resultado?.id)
            .onAppear {
                guard !listo else { return }
                listo = true
                totalTexto = String(format: "%.2f", t.countVerificados > 0 ? t.totalVerificado : t.totalEstimado)
            }
        }
    }
}

/// Elegir qué pendientes de Recordatorios agregar.
struct ImportarRecordatoriosView: View {
    let listaId: String
    let pendientes: [Recordatorios.Item]
    @Environment(Datos.self) private var datos
    @Environment(\.dismiss) private var dismiss
    @State private var elegidos: Set<Int> = []
    @State private var listo = false

    var body: some View {
        NavigationStack {
            List(Array(pendientes.enumerated()), id: \.offset) { i, p in
                Button {
                    if elegidos.contains(i) { elegidos.remove(i) } else { elegidos.insert(i) }
                } label: {
                    HStack {
                        Image(systemName: elegidos.contains(i) ? "checkmark.circle.fill" : "circle")
                            .foregroundStyle(elegidos.contains(i) ? Estilo.marca : .secondary)
                        VStack(alignment: .leading) {
                            Text(p.nombre).foregroundStyle(.primary)
                            if let l = p.lista { Text(l).font(.caption).foregroundStyle(.secondary) }
                        }
                    }
                }
            }
            .navigationTitle("Desde Recordatorios")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancelar") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Agregar \(elegidos.count)") {
                        for i in elegidos.sorted() {
                            datos.agregar(.init(nombre: pendientes[i].nombre, fuente: "recordatorios", listaId: listaId))
                        }
                        dismiss()
                    }
                    .disabled(elegidos.isEmpty)
                }
            }
            .onAppear {
                guard !listo else { return }
                listo = true
                // Marcados de entrada los que aún no están en la lista.
                elegidos = Set(pendientes.indices.filter { datos.itemSimilar(pendientes[$0].nombre, en: listaId) == nil })
            }
        }
    }
}
