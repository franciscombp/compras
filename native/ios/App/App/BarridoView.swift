import SwiftUI
import AVFoundation
import UIKit

/// Pantalla nativa del barrido: cámara a pantalla completa, overlay con cada
/// etiqueta detectada y su precio por 100 g (lo calcula la web), controles de
/// pausa, linterna y cierre. Los datos y las listas siguen viviendo en la web.
struct BarridoView: View {
    @ObservedObject var modelo: BarridoModelo

    private let rojo = Color(red: 0.77, green: 0.12, blue: 0.12)
    private let verde = Color(red: 0.20, green: 0.78, blue: 0.35)

    var body: some View {
        ZStack {
            CamaraPreview(capa: modelo.capaPreview)
                .ignoresSafeArea()

            GeometryReader { geo in
                Canvas { ctx, tam in
                    dibujar(ctx: &ctx, tam: tam)
                }
                .contentShape(Rectangle())
                .onTapGesture(coordinateSpace: .local) { punto in
                    modelo.tocar(punto, tamano: geo.size)
                }
            }
            .ignoresSafeArea()

            VStack(spacing: 0) {
                HStack(spacing: 10) {
                    boton("xmark", etiqueta: "Listo") { modelo.alCerrar?() }
                    Spacer()
                    boton(modelo.linterna ? "flashlight.on.fill" : "flashlight.off.fill", etiqueta: "Linterna", activo: modelo.linterna) { modelo.alternarLinterna() }
                    boton(modelo.pausado ? "play.fill" : "pause.fill", etiqueta: modelo.pausado ? "Seguir" : "Pausa", activo: modelo.pausado) { modelo.alternarPausa() }
                }
                .padding(.horizontal, 14)
                .padding(.top, 10)

                Spacer()

                VStack(spacing: 6) {
                    if modelo.sinPermiso {
                        Text("Quanto necesita la cámara. Actívala en Ajustes > Quanto.")
                    } else {
                        Text(modelo.estado)
                    }
                    Text("Pasea la cámara por el estante. Toca una etiqueta para agregarla ya o revisarla.")
                        .font(.system(size: 12))
                        .foregroundStyle(.white.opacity(0.75))
                }
                .font(.system(size: 13.5, weight: .semibold))
                .foregroundStyle(.white)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 20)
                .padding(.vertical, 14)
                .frame(maxWidth: .infinity)
                .background(LinearGradient(colors: [.clear, .black.opacity(0.65)], startPoint: .top, endPoint: .bottom))
            }
        }
        .background(Color.black)
        .statusBarHidden(true)
        .onAppear { modelo.iniciar() }
        .onDisappear { modelo.detener() }
    }

    private func boton(_ simbolo: String, etiqueta: String, activo: Bool = false, accion: @escaping () -> Void) -> some View {
        Button(action: accion) {
            HStack(spacing: 6) {
                Image(systemName: simbolo).font(.system(size: 13, weight: .semibold))
                Text(etiqueta).font(.system(size: 12.5, weight: .semibold))
            }
            .foregroundStyle(activo ? Color.black : Color.white)
            .padding(.horizontal, 14).padding(.vertical, 9)
            .background(activo ? Color.white : Color.black.opacity(0.38), in: Capsule())
            .overlay(Capsule().strokeBorder(Color.white.opacity(0.5), lineWidth: 1))
        }
        .accessibilityLabel(etiqueta)
    }

    private func dibujar(ctx: inout GraphicsContext, tam: CGSize) {
        for v in modelo.vistas {
            let r = modelo.rectEnPantalla(v.caja, tamano: tam).insetBy(dx: -6, dy: -6)
            let chip = modelo.chips[v.id]
            let esMejor = chip?.estado == "mejor"
            let color: Color = esMejor ? verde : v.confirmada ? .white : .white.opacity(0.6)
            let trazo = StrokeStyle(lineWidth: esMejor ? 3 : 2, dash: v.confirmada ? [] : [6, 5])
            ctx.stroke(Path(roundedRect: r, cornerRadius: 10), with: .color(color), style: trazo)

            let texto: String
            if let c = chip {
                texto = esMejor ? "★ Mejor · \(c.texto)" : c.texto
            } else {
                texto = String(format: "$%.2f", v.precio) + (v.confirmada ? "" : " …")
            }
            let fondo: Color = esMejor ? verde : v.confirmada ? rojo : .black.opacity(0.55)
            let resuelto = ctx.resolve(Text(texto).font(.system(size: 13, weight: .semibold)).foregroundColor(.white))
            let medida = resuelto.measure(in: CGSize(width: tam.width - 16, height: 40))
            let ancho = medida.width + 18, alto: CGFloat = 24
            var x = min(max(4, r.minX), tam.width - ancho - 4)
            var y = r.minY - alto - 6
            if y < 60 { y = r.minY + 6; x = min(max(4, r.minX + 6), tam.width - ancho - 4) }
            let caja = CGRect(x: x, y: y, width: ancho, height: alto)
            ctx.fill(Path(roundedRect: caja, cornerRadius: 12), with: .color(fondo))
            ctx.draw(resuelto, at: CGPoint(x: caja.minX + 9, y: caja.midY), anchor: .leading)
        }
    }
}

/// Capa de previsualización de AVFoundation dentro de SwiftUI.
struct CamaraPreview: UIViewRepresentable {
    let capa: AVCaptureVideoPreviewLayer

    func makeUIView(context: Context) -> VistaPreview {
        let v = VistaPreview()
        v.backgroundColor = .black
        v.capa = capa
        v.layer.addSublayer(capa)
        return v
    }

    func updateUIView(_ uiView: VistaPreview, context: Context) {
        uiView.capa?.frame = uiView.bounds
    }

    final class VistaPreview: UIView {
        var capa: AVCaptureVideoPreviewLayer?
        override func layoutSubviews() {
            super.layoutSubviews()
            CATransaction.begin()
            CATransaction.setDisableActions(true)
            capa?.frame = bounds
            CATransaction.commit()
        }
    }
}

/// Contenedor UIKit: pantalla completa, solo vertical, sin barra de estado.
final class BarridoHost: UIHostingController<BarridoView> {
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .portrait }
    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }
}
