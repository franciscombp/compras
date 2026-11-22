import SwiftUI
import UniformTypeIdentifiers

struct AjustesView: View {
    @Environment(Datos.self) private var datos
    @Environment(\.dismiss) private var dismiss
    @State private var tienda = ""
    @State private var presupuesto = ""
    @State private var copia: URL?
    @State private var importando = false
    @State private var archivoImportado: Data?
    @State private var mensaje: String?
    @State private var trayendoAnterior = false
    @State private var listo = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Tienda habitual (ej.: Supermaxi)", text: $tienda)
                        .textInputAutocapitalization(.words)
                    HStack {
                        Text("Presupuesto por compra")
                        Spacer()
                        TextField("Ninguno", text: $presupuesto)
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                            .frame(maxWidth: 120)
                    }
                } header: {
                    Text("Tus compras")
                } footer: {
                    Text("Las listas nuevas empiezan con esta tienda y este presupuesto.")
                }

                Section {
                    LabeledContent("Apple Intelligence", value: AppleIA.disponible() ? "Activo" : "No disponible")
                } footer: {
                    Text(AppleIA.disponible()
                         ? "Entiende frases al agregar productos, afina lo que lee la cámara y explica las comparaciones. Todo en el iPhone, sin costo."
                         : "Con un iPhone compatible y Apple Intelligence activado, Quanto entiende frases, afina las etiquetas y te explica las comparaciones. Sin ella todo funciona igual con la lógica local.")
                }

                Section {
                    if let url = copia {
                        ShareLink(item: url) { Label("Exportar copia de seguridad", systemImage: "square.and.arrow.up") }
                    }
                    Button { importando = true } label: { Label("Importar copia…", systemImage: "square.and.arrow.down") }
                    Button {
                        Task {
                            trayendoAnterior = true
                            let r = await MigracionWeb.traer(datos)
                            trayendoAnterior = false
                            mensaje = r.map { "Traje \($0.listas) listas, \($0.items) productos y \($0.precios) precios." }
                                ?? "No encontré datos de la versión anterior en este iPhone."
                        }
                    } label: {
                        HStack {
                            Label("Traer datos de la versión anterior", systemImage: "clock.arrow.circlepath")
                            if trayendoAnterior { Spacer(); ProgressView() }
                        }
                    }
                    .disabled(trayendoAnterior)
                } header: {
                    Text("Tus datos")
                } footer: {
                    Text("Todo se guarda solo en este iPhone. La copia es el mismo archivo que exporta la versión web de Quanto, así que sirve para pasar datos entre las dos.")
                }

                Section {
                    LabeledContent("Versión", value: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "—")
                    Link(destination: URL(string: "https://franciscombp.github.io/compras/")!) {
                        Label("Quanto en la web", systemImage: "safari")
                    }
                }
            }
            .navigationTitle("Ajustes")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Listo") {
                        datos.guardarAjustes(tienda: tienda, presupuesto: Formato.leerNumero(presupuesto))
                        dismiss()
                    }
                }
            }
            .fileImporter(isPresented: $importando, allowedContentTypes: [.json]) { resultado in
                guard case .success(let url) = resultado else { return }
                let acceso = url.startAccessingSecurityScopedResource()
                defer { if acceso { url.stopAccessingSecurityScopedResource() } }
                archivoImportado = try? Data(contentsOf: url)
                if archivoImportado == nil { mensaje = "No se pudo leer el archivo." }
            }
            .confirmationDialog("¿Cómo importar la copia?", isPresented: Binding(get: { archivoImportado != nil }, set: { if !$0 { archivoImportado = nil } }), titleVisibility: .visible) {
                Button("Sumar a lo que tengo") { importar(reemplazar: false) }
                Button("Reemplazar todo", role: .destructive) { importar(reemplazar: true) }
                Button("Cancelar", role: .cancel) { archivoImportado = nil }
            }
            .alert(mensaje ?? "", isPresented: Binding(get: { mensaje != nil }, set: { if !$0 { mensaje = nil } })) {
                Button("OK") {}
            }
            .onAppear {
                guard !listo else { return }
                listo = true
                let a = datos.ajustes()
                tienda = a.tiendaHabitual ?? ""
                presupuesto = Formato.texto(a.presupuestoDefecto)
                copia = escribirCopia()
            }
        }
    }

    private func escribirCopia() -> URL? {
        guard let data = datos.exportarJSON() else { return nil }
        let fecha = Date().formatted(.iso8601.year().month().day())
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("quanto-copia-\(fecha).json")
        return (try? data.write(to: url, options: .atomic)) != nil ? url : nil
    }

    private func importar(reemplazar: Bool) {
        guard let data = archivoImportado else { return }
        archivoImportado = nil
        do {
            let r = try datos.importar(data, reemplazar: reemplazar)
            mensaje = "Listo: \(r.listas) listas, \(r.items) productos y \(r.precios) precios."
            copia = escribirCopia()
        } catch {
            mensaje = error.localizedDescription
        }
    }
}
