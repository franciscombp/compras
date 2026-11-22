import SwiftUI

struct RaizView: View {
    @Environment(Datos.self) private var datos
    @Environment(Navegacion.self) private var navegacion
    @State private var aviso: String?

    var body: some View {
        @Bindable var nav = navegacion
        TabView(selection: $nav.pestana) {
            InicioView()
                .tabItem { Label("Inicio", systemImage: "house.fill") }
                .tag(Pestana.inicio)
            CompararView()
                .tabItem { Label("Comparar", systemImage: "scalemass.fill") }
                .tag(Pestana.comparar)
            ListasView()
                .tabItem { Label("Listas", systemImage: "checklist") }
                .tag(Pestana.listas)
            AhorroView()
                .tabItem { Label("Ahorro", systemImage: "chart.line.downtrend.xyaxis") }
                .tag(Pestana.ahorro)
        }
        .fullScreenCover(isPresented: $nav.escanerAbierto) {
            EscanerView().entorno()
        }
        .task {
            if let r = await MigracionWeb.alArrancar(datos) {
                aviso = "Traje \(r.listas) \(r.listas == 1 ? "lista" : "listas"), \(r.items) productos y \(r.precios) precios de la versión anterior de Quanto."
            }
        }
        .alert("Tus datos siguen aquí", isPresented: Binding(get: { aviso != nil }, set: { if !$0 { aviso = nil } })) {
            Button("Perfecto") {}
        } message: {
            Text(aviso ?? "")
        }
    }
}
