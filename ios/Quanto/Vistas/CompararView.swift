import SwiftUI
import PhotosUI
import UIKit

/// Comparador: cada producto con precio y contenido; el ranking por 100 g/ml
/// se arma solo. Las etiquetas del escáner llegan aquí como filas.
struct CompararView: View {
    @Environment(Datos.self) private var datos
    @Environment(Comparador.self) private var comparador
    @Environment(Navegacion.self) private var navegacion
    @State private var nota: AppleIA.Nota?
    @State private var agregado: UUID?
    @State private var foto: PhotosPickerItem?
    @State private var leyendoFoto = false
    @State private var aviso: String?

    private static var notasCache: [String: AppleIA.Nota] = [:]

    var body: some View {
        @Bindable var comparador = comparador
        let ranking = comparador.ranking(datos)
        let mejorId = ranking.count >= 2 ? ranking.first?.id : nil
        NavigationStack {
            List {
                Section {
                    ForEach($comparador.filas) { $fila in
                        let puesto = ranking.first { $0.id == fila.id }
                        FilaEditor(fila: $fila,
                                   titulo: comparador.titulo(de: fila),
                                   esMejor: fila.id == mejorId,
                                   puesto: puesto,
                                   semaforo: datos.semaforo(nombre: fila.nombre, precio: fila.precio, contenido: fila.contenido,
                                                            unidad: fila.unidad.base, unidades: Double(fila.unidades)))
                    }
                    .onDelete { comparador.filas.remove(atOffsets: $0) }

                    Button { comparador.agregarFila() } label: {
                        Label("Añadir producto", systemImage: "plus.circle.fill")
                    }
                    Button { navegacion.abrirEscaner() } label: {
                        Label("Escanear etiquetas del estante", systemImage: "viewfinder")
                    }
                    PhotosPicker(selection: $foto, matching: .images) {
                        HStack {
                            Label(leyendoFoto ? "Leyendo la foto…" : "Leer una etiqueta de una foto", systemImage: "photo.on.rectangle")
                            if leyendoFoto { Spacer(); ProgressView() }
                        }
                    }
                    .disabled(leyendoFoto)
                } header: {
                    Text("Productos")
                } footer: {
                    Text("Precio y contenido de cada envase. Si es un pack, cambia × 1 por el número de envases.")
                }

                if ranking.count >= 2 {
                    resultado(ranking)
                } else if ranking.count == 1 {
                    Section {
                        Label("Falta otro producto con precio y contenido para comparar.", systemImage: "info.circle")
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .navigationTitle("Comparar")
            .scrollDismissesKeyboard(.interactively)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button { comparador.ejemplo() } label: { Label("Llenar con un ejemplo", systemImage: "wand.and.stars") }
                        Button(role: .destructive) { comparador.limpiar(); nota = nil } label: { Label("Empezar de nuevo", systemImage: "trash") }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                    .accessibilityLabel("Más opciones")
                }
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("Listo") { Teclado.ocultar() }
                }
            }
            .task(id: ranking.count >= 2 ? Comparador.resumen(ranking) : "") {
                await explicar(ranking)
            }
            .onChange(of: foto) { _, nueva in
                guard let nueva else { return }
                Task { await leerFoto(nueva) }
            }
            .alert(aviso ?? "", isPresented: Binding(get: { aviso != nil }, set: { if !$0 { aviso = nil } })) {
                Button("OK") {}
            }
        }
    }

    @ViewBuilder
    private func resultado(_ ranking: [Puesto]) -> some View {
        let mejor = ranking[0]
        let segundo = ranking[1]
        Section {
            VStack(alignment: .leading, spacing: 6) {
                Label("Conviene \(mejor.titulo)", systemImage: "star.fill")
                    .font(.headline)
                    .foregroundStyle(Estilo.bueno)
                Text("\(Formato.normalizado(mejor.normalizado)) por \(Formato.base(mejor.fila.unidad.base)), \(Formato.porcentaje(segundo.sobreMejor)) menos que \(segundo.titulo).")
                    .font(.subheadline)
                if comparador.mezclaUnidades() {
                    Label("Mezclas productos en g y en ml: la comparación es aproximada.", systemImage: "exclamationmark.triangle")
                        .font(.caption).foregroundStyle(Estilo.aviso)
                }
            }
            .padding(.vertical, 4)

            if let n = nota { NotaIA(nota: n) }

            ForEach(Array(ranking.enumerated()), id: \.element.id) { i, p in
                HStack {
                    Text("\(i + 1)")
                        .font(.subheadline.weight(.bold).monospacedDigit())
                        .frame(width: 24, height: 24)
                        .background(i == 0 ? Estilo.bueno.opacity(0.18) : Color(.tertiarySystemFill), in: Circle())
                        .foregroundStyle(i == 0 ? Estilo.bueno : .secondary)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(p.titulo).lineLimit(1)
                        Text("\(Formato.precio(p.fila.precio)) · \(Formato.contenido(p.totalContenido, p.fila.unidad.base) ?? "")")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(Formato.normalizado(p.normalizado)).font(.body.weight(.semibold).monospacedDigit())
                        Text(i == 0 ? "por \(Formato.base(p.fila.unidad.base))" : "+\(Formato.porcentaje(p.sobreMejor))")
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(i == 0 ? Color.secondary : Estilo.caro)
                    }
                }
                .accessibilityElement(children: .combine)
            }

            Button {
                agregarMejor(mejor, ranking: ranking)
            } label: {
                Label(agregado == mejor.id ? "Agregado a tu lista" : "Agregar \(mejor.titulo) a mi lista",
                      systemImage: agregado == mejor.id ? "checkmark.circle.fill" : "cart.badge.plus")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .disabled(agregado == mejor.id)
            .sensoryFeedback(.success, trigger: agregado)
            .listRowInsets(EdgeInsets(top: 10, leading: 16, bottom: 10, trailing: 16))
        } header: {
            Text("Resultado")
        }
    }

    private func agregarMejor(_ mejor: Puesto, ranking: [Puesto]) {
        let f = mejor.fila
        let listaId = datos.listaActivaId()
        datos.agregar(.init(nombre: mejor.titulo, cantidad: 1, precio: f.precio, contenido: mejor.totalContenido,
                            unidad: f.unidad.base, verificado: f.deEscaner, fuente: f.deEscaner ? "ocr" : "comparador", listaId: listaId))
        datos.guardarComparacion(origen: f.deEscaner ? "escaner" : "comparador", productos: ranking.map {
            .init(nombre: $0.titulo, precio: $0.fila.precio ?? 0, totalContenido: $0.totalContenido, unidad: $0.fila.unidad.base, normalizado: $0.normalizado)
        })
        agregado = mejor.id
    }

    /// Foto de la galería -> Vision (marco de la etiqueta) -> parser de la web -> fila.
    private func leerFoto(_ item: PhotosPickerItem) async {
        leyendoFoto = true
        defer { leyendoFoto = false; foto = nil }
        guard let data = try? await item.loadTransferable(type: Data.self), let original = UIImage(data: data) else {
            aviso = "No se pudo abrir la foto."
            return
        }
        // Derecha y a lo sumo 2000 px de lado: Vision lee bien y no se demora.
        let escala = min(1, 2000 / max(original.size.width, original.size.height))
        let tam = CGSize(width: original.size.width * escala, height: original.size.height * escala)
        let formato = UIGraphicsImageRendererFormat()
        formato.scale = 1
        let derecha = UIGraphicsImageRenderer(size: tam, format: formato).image { _ in original.draw(in: CGRect(origin: .zero, size: tam)) }
        guard let cg = derecha.cgImage else { return }
        let lectura = await Task.detached(priority: .userInitiated) { try? LectorEtiqueta.leer(cg) }.value
        guard let lectura, !lectura.texto.isEmpty else { aviso = "No encontré texto en la foto."; return }
        let l = datos.leerEtiqueta(texto: lectura.texto, palabras: lectura.palabras)
        guard l.precio != nil else { aviso = "No encontré un precio en la etiqueta. Prueba con una foto más cerca."; return }
        var f = Fila.desde(l)
        f.textoOCR = lectura.texto
        let miniEscala = min(1, 320 / max(tam.width, 1))
        let miniTam = CGSize(width: tam.width * miniEscala, height: tam.height * miniEscala)
        f.miniatura = UIGraphicsImageRenderer(size: miniTam).image { _ in derecha.draw(in: CGRect(origin: .zero, size: miniTam)) }
        comparador.incorporar(f)
        await comparador.afinar(f.id, texto: lectura.texto, codigo: l.codigo ?? lectura.codigo, datos: datos)
    }

    /// Explicación en lenguaje natural, cuando la comparación se asienta.
    private func explicar(_ ranking: [Puesto]) async {
        guard ranking.count >= 2, AppleIA.disponible() else { nota = nil; return }
        let resumen = Comparador.resumen(ranking)
        if let n = Self.notasCache[resumen] { nota = n; return }
        try? await Task.sleep(for: .milliseconds(700))
        guard !Task.isCancelled else { return }
        if let n = try? await AppleIA.veredicto(resumen: resumen) {
            Self.notasCache[resumen] = n
            if !Task.isCancelled { nota = n }
        }
    }
}

/// Editor de un producto del comparador.
struct FilaEditor: View {
    @Binding var fila: Fila
    let titulo: String
    let esMejor: Bool
    let puesto: Puesto?
    let semaforo: Semaforo

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                if let img = fila.miniatura {
                    Image(uiImage: img)
                        .resizable()
                        .scaledToFill()
                        .frame(width: 44, height: 44)
                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                        .accessibilityHidden(true)
                }
                TextField(titulo, text: editando(\.nombre))
                    .font(.headline)
                    .submitLabel(.done)
                if esMejor {
                    Label("Mejor", systemImage: "star.fill")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 8).padding(.vertical, 4)
                        .background(Estilo.bueno, in: Capsule())
                }
            }
            HStack(spacing: 8) {
                CampoNumero(titulo: "Precio", texto: editando(\.precioTexto), prefijo: "$")
                CampoNumero(titulo: "Contenido", texto: editando(\.contenidoTexto))
                SelectorUnidad(unidad: editando(\.unidad))
                Menu {
                    Picker("Envases", selection: editando(\.unidades)) {
                        ForEach(1...24, id: \.self) { Text("× \($0)").tag($0) }
                    }
                } label: {
                    Text("× \(fila.unidades)")
                        .font(.body.weight(.medium).monospacedDigit())
                        .padding(.horizontal, 10)
                        .frame(minWidth: 48, minHeight: 40)
                        .background(Color(.tertiarySystemFill), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                }
                .accessibilityLabel("Envases: \(fila.unidades)")
            }
            HStack(spacing: 8) {
                if let p = puesto {
                    Text("\(Formato.normalizado(p.normalizado)) por \(Formato.base(fila.unidad.base))")
                        .font(.subheadline.weight(.semibold).monospacedDigit())
                        .foregroundStyle(esMejor ? Estilo.bueno : .secondary)
                }
                SemaforoChip(semaforo: semaforo)
                Spacer(minLength: 0)
            }
            if let na = fila.precioNoAfiliado {
                Text("Sin afiliación: \(Formato.precio(na))").font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 6)
    }

    /// Lo que la persona escribe marca la fila como editada.
    private func editando<T>(_ campo: WritableKeyPath<Fila, T>) -> Binding<T> {
        Binding(get: { fila[keyPath: campo] }, set: { fila[keyPath: campo] = $0; fila.editada = true })
    }
}
