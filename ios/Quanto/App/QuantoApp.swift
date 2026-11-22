import SwiftUI

@main
struct QuantoApp: App {
    @State private var datos = Datos.compartido
    @State private var comparador = Comparador.compartido
    @State private var navegacion = Navegacion.compartida
    @Environment(\.scenePhase) private var fase

    init() {
        AppleIA.precalentar()
    }

    var body: some Scene {
        WindowGroup {
            RaizView()
                .environment(datos)
                .environment(comparador)
                .environment(navegacion)
        }
        .onChange(of: fase) { _, nueva in
            if nueva == .background { datos.esperarGuardado() }
        }
    }
}

extension View {
    /// Las hojas y pantallas completas reciben los mismos datos que la app.
    @MainActor
    func entorno() -> some View {
        environment(Datos.compartido)
            .environment(Comparador.compartido)
            .environment(Navegacion.compartida)
    }
}
