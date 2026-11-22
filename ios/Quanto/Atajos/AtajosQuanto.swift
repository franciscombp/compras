import AppIntents

/// "Oye Siri, agrega a mi lista de Quanto" -> pregunta qué y lo agrega a la
/// lista activa. Con Apple Intelligence entiende frases como "dos leches Vita
/// de litro a 1.25".
struct AgregarALaListaIntent: AppIntent {
    static let title: LocalizedStringResource = "Agregar a la lista"
    static let description = IntentDescription("Agrega un producto a tu lista activa de Quanto.")

    @Parameter(title: "Producto", requestValueDialog: "¿Qué quieres agregar?")
    var producto: String

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let datos = Datos.compartido
        let listaId = datos.listaActivaId()
        var nuevo = Datos.NuevoItem(nombre: producto, fuente: "siri", listaId: listaId)
        if AppleIA.disponible(), let p = try? await AppleIA.producto(frase: producto) {
            if !p.nombre.isEmpty { nuevo.nombre = p.nombre }
            nuevo.cantidad = Double(p.cantidad)
            nuevo.precio = p.precio
            nuevo.contenido = p.contenido
            nuevo.unidad = p.unidad
        } else if let m = datos.medidaDeNombre(producto) {
            nuevo.contenido = m.contenido
            nuevo.unidad = m.unidad
        }
        datos.agregar(nuevo)
        datos.esperarGuardado()
        let lista = datos.lista(listaId)?.nombre ?? "tu lista"
        return .result(dialog: "Listo, agregué \(nuevo.nombre) a \(lista).")
    }
}

/// "Oye Siri, escanea precios con Quanto" -> abre la cámara del estante.
struct AbrirEscanerIntent: AppIntent {
    static let title: LocalizedStringResource = "Escanear el estante"
    static let description = IntentDescription("Abre la cámara de Quanto para comparar etiquetas de precio.")
    static let openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        Navegacion.compartida.abrirEscaner()
        return .result()
    }
}

/// "¿Cuánto llevo en Quanto?" -> total de la lista activa.
struct TotalListaIntent: AppIntent {
    static let title: LocalizedStringResource = "Total de la lista"
    static let description = IntentDescription("Dice cuánto suma tu lista activa y cuánto queda del presupuesto.")

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let datos = Datos.compartido
        let id = datos.listaActivaId()
        let t = datos.totales(id)
        var texto = "Tu lista suma \(Formato.precio(t.totalEstimado)) en \(t.countActivos) productos"
        if let p = datos.lista(id)?.presupuesto, p > 0 {
            texto += t.totalEstimado > p ? ", \(Formato.precio(t.totalEstimado - p)) sobre tu presupuesto" : "; te quedan \(Formato.precio(p - t.totalEstimado))"
        }
        return .result(dialog: "\(texto).")
    }
}

struct AtajosQuanto: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: AgregarALaListaIntent(),
                    phrases: ["Agrega a mi lista de \(.applicationName)", "Anota en \(.applicationName)"],
                    shortTitle: "Agregar a la lista",
                    systemImageName: "cart.badge.plus")
        AppShortcut(intent: AbrirEscanerIntent(),
                    phrases: ["Escanea precios con \(.applicationName)", "Compara precios con \(.applicationName)"],
                    shortTitle: "Escanear estante",
                    systemImageName: "viewfinder")
        AppShortcut(intent: TotalListaIntent(),
                    phrases: ["¿Cuánto llevo en \(.applicationName)?", "Total de mi lista de \(.applicationName)"],
                    shortTitle: "Total de la lista",
                    systemImageName: "sum")
    }
}
