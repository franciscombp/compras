import SwiftUI
import Observation

/// Une la cámara nativa (BarridoModelo) con el comparador: cada etiqueta
/// confirmada se parsea con el parser de la web, entra como fila, Apple
/// Intelligence la afina (nombre, contenido, pack; nunca el precio) y el
/// overlay recibe el precio por 100 g y el ganador.
@MainActor
@Observable
final class EscanerSesion {
    let modelo = BarridoModelo()
    var ficha: UUID?

    private let datos: Datos
    private let comparador: Comparador

    init(datos: Datos, comparador: Comparador) {
        self.datos = datos
        self.comparador = comparador
        // BarridoModelo llama estos cierres en el hilo principal.
        modelo.alConfirmar = { [weak self] c in MainActor.assumeIsolated { self?.incorporar(c) } }
        modelo.alTocar = { [weak self] id in MainActor.assumeIsolated { self?.abrirFicha(barridoId: id) } }
    }

    var capturadas: Int { comparador.filas.filter(\.deEscaner).count }

    private func incorporar(_ c: BarridoModelo.Confirmada) {
        let l = datos.leerEtiqueta(texto: c.texto, palabras: c.palabras, precioRespaldo: c.precio)
        guard let precio = l.precio, precio > 0 else { return }
        let firma = Fila.huella(l)
        // La cámara puede volver a entregar la misma etiqueta con otro id.
        if let i = comparador.filas.firstIndex(where: { $0.firma == firma }) {
            comparador.filas[i].idsBarrido.insert(c.id)
            enviarChips()
            return
        }
        var f = Fila.desde(l)
        f.firma = firma
        f.idsBarrido = [c.id]
        f.miniatura = c.miniatura
        f.textoOCR = c.texto
        comparador.incorporar(f)
        enviarChips()
        let id = f.id
        Task { await comparador.afinar(id, texto: c.texto, codigo: l.codigo, datos: datos) { [weak self] in self?.enviarChips() } }
    }

    /// Chip de cada etiqueta en el overlay: precio por 100 g y el ganador.
    func enviarChips() {
        let ranking = comparador.ranking(datos)
        let mejor = ranking.count >= 2 ? ranking.first?.id : nil
        var chips: [String: BarridoModelo.Chip] = [:]
        for f in comparador.filas where !f.idsBarrido.isEmpty {
            let puesto = ranking.first { $0.id == f.id }
            let texto = puesto.map { "\(Formato.normalizado($0.normalizado)) / \(Formato.base(f.unidad.base))" }
                ?? "\(Formato.precio(f.precio)) · ¿gramaje?"
            let estado = f.id == mejor ? "mejor" : puesto != nil ? "ok" : "sinGramaje"
            for id in f.idsBarrido { chips[id] = .init(texto: texto, estado: estado) }
        }
        modelo.actualizarChips(chips)
    }

    private func abrirFicha(barridoId: String) {
        guard let f = comparador.filas.first(where: { $0.idsBarrido.contains(barridoId) }) else { return }
        if !modelo.pausado { modelo.alternarPausa() }
        ficha = f.id
    }
}

struct EscanerView: View {
    @Environment(Datos.self) private var datos
    @Environment(Comparador.self) private var comparador
    @Environment(Navegacion.self) private var navegacion
    @Environment(\.dismiss) private var dismiss
    @State private var sesion: EscanerSesion?

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            if let s = sesion {
                BarridoView(modelo: s.modelo)
                    .overlay(alignment: .bottom) {
                        if s.capturadas > 0 {
                            Button { cerrar() } label: {
                                Label("Ver comparación (\(s.capturadas))", systemImage: "list.number")
                                    .font(.subheadline.weight(.semibold))
                                    .padding(.horizontal, 18).padding(.vertical, 12)
                                    .background(.regularMaterial, in: Capsule())
                            }
                            .padding(.bottom, 96)
                        }
                    }
                    .sheet(item: fichaAbierta(s)) { ruta in
                        FichaCaptura(filaId: ruta.id)
                            .entorno()
                            .presentationDetents([.medium, .large])
                            .onDisappear {
                                s.enviarChips()
                                if s.modelo.pausado { s.modelo.alternarPausa() }
                            }
                    }
            }
        }
        .onAppear {
            guard sesion == nil else { return }
            let s = EscanerSesion(datos: datos, comparador: comparador)
            s.modelo.alCerrar = { MainActor.assumeIsolated { cerrar() } }
            sesion = s
        }
    }

    private func cerrar() {
        sesion?.modelo.detener()
        if (sesion?.capturadas ?? 0) > 0 { navegacion.pestana = .comparar }
        dismiss()
    }

    private struct RutaFicha: Identifiable { let id: UUID }

    private func fichaAbierta(_ s: EscanerSesion) -> Binding<RutaFicha?> {
        Binding(get: { s.ficha.map(RutaFicha.init) }, set: { s.ficha = $0?.id })
    }
}

/// Ficha de una etiqueta capturada: corregir lo que se leyó mal.
struct FichaCaptura: View {
    let filaId: UUID
    @Environment(Comparador.self) private var comparador
    @Environment(Datos.self) private var datos
    @Environment(\.dismiss) private var dismiss
    @State private var quitar = false

    /// Por id y no por índice: la fila puede cambiar de lugar mientras la hoja está abierta.
    private var fila: Binding<Fila> {
        Binding(get: { comparador.filas.first { $0.id == filaId } ?? Fila() },
                set: { nueva in
                    if let j = comparador.filas.firstIndex(where: { $0.id == filaId }) { comparador.filas[j] = nueva }
                })
    }

    var body: some View {
        NavigationStack {
            if comparador.filas.contains(where: { $0.id == filaId }) {
                let fila = self.fila.wrappedValue
                Form {
                    if let img = fila.miniatura {
                        Section {
                            Image(uiImage: img)
                                .resizable()
                                .scaledToFit()
                                .frame(maxHeight: 160)
                                .frame(maxWidth: .infinity)
                        }
                    }
                    Section {
                        FilaEditor(fila: self.fila, titulo: comparador.titulo(de: fila), esMejor: false, puesto: nil,
                                   semaforo: datos.semaforo(nombre: fila.nombre, precio: fila.precio, contenido: fila.contenido,
                                                            unidad: fila.unidad.base, unidades: Double(fila.unidades)))
                    } footer: {
                        if !fila.textoOCR.isEmpty {
                            Text("Leído: \(fila.textoOCR.replacingOccurrences(of: "\n", with: " · "))")
                        }
                    }
                    Section {
                        Button("Quitar esta etiqueta", role: .destructive) {
                            quitar = true
                            dismiss()
                        }
                    }
                }
                .navigationTitle("Etiqueta")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) { Button("Listo") { dismiss() } }
                }
            } else {
                ContentUnavailableView("Etiqueta quitada", systemImage: "tag.slash")
            }
        }
        .onDisappear {
            if quitar { comparador.filas.removeAll { $0.id == filaId } }
        }
    }
}
