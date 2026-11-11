import Foundation
import Capacitor
import UIKit

/// Puente entre la web de Quanto y las capacidades del iPhone.
/// La web habla con `window.Capacitor.Plugins.QuantoNativo` a través de
/// data/nativo.js; en Android o web ese módulo usa otras implementaciones.
///
/// Métodos:
///   capacidades()                       -> { vision, codigoBarras, appleIntelligence, plataforma }
///   leerEtiqueta({ imagen, ia })        -> { texto, palabras, codigo, ia, iaEstado }
///   interpretarProducto({ frase })      -> { nombre, cantidad, precio, contenido, unidad } | { ia: null }
///   explicarComparacion({ resumen })    -> { titulo, explicacion } | { ia: null }
///   haptico({ tipo })                   -> tipo: "exito" | "aviso" | "toque"
///   mantenerPantalla({ activo })
@objc(QuantoNativoPlugin)
public class QuantoNativoPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "QuantoNativoPlugin"
    public let jsName = "QuantoNativo"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "capacidades", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "leerEtiqueta", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "interpretarProducto", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "explicarComparacion", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "haptico", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "mantenerPantalla", returnType: CAPPluginReturnPromise),
    ]

    public override func load() {
        AppleIA.precalentar()
    }

    @objc func capacidades(_ call: CAPPluginCall) {
        call.resolve([
            "vision": true,
            "codigoBarras": true,
            "appleIntelligence": AppleIA.disponible(),
            "plataforma": "ios",
        ])
    }

    @objc func leerEtiqueta(_ call: CAPPluginCall) {
        guard let base64 = call.getString("imagen"),
              let data = Data(base64Encoded: base64, options: .ignoreUnknownCharacters),
              let cg = UIImage(data: data)?.cgImage else {
            call.reject("imagen_invalida")
            return
        }
        let usarIA = call.getBool("ia") ?? true

        DispatchQueue.global(qos: .userInitiated).async {
            let lectura: LectorEtiqueta.Lectura
            do {
                lectura = try LectorEtiqueta.leer(cg)
            } catch {
                call.reject("vision: \(error.localizedDescription)")
                return
            }

            var resultado: [String: Any] = [
                "texto": lectura.texto,
                "palabras": lectura.palabras,
                "codigo": lectura.codigo ?? NSNull(),
                "motor": "vision",
                "ia": NSNull(),
                "iaEstado": usarIA ? "no_disponible" : "desactivada",
            ]

            guard usarIA, !lectura.texto.isEmpty, AppleIA.disponible() else {
                call.resolve(resultado)
                return
            }
            Task {
                do {
                    if let ia = try await AppleIA.etiqueta(texto: lectura.texto) {
                        resultado["ia"] = ia
                        resultado["iaEstado"] = "ok"
                    }
                } catch {
                    resultado["iaEstado"] = "error: \(error.localizedDescription)"
                }
                call.resolve(resultado)
            }
        }
    }

    @objc func interpretarProducto(_ call: CAPPluginCall) {
        let frase = (call.getString("frase") ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !frase.isEmpty else { call.reject("frase_vacia"); return }
        Task {
            do {
                if let p = try await AppleIA.producto(frase: frase) {
                    call.resolve(p)
                } else {
                    call.resolve(["ia": NSNull()])
                }
            } catch {
                call.reject("ia: \(error.localizedDescription)")
            }
        }
    }

    @objc func explicarComparacion(_ call: CAPPluginCall) {
        let resumen = (call.getString("resumen") ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !resumen.isEmpty else { call.reject("resumen_vacio"); return }
        Task {
            do {
                if let v = try await AppleIA.veredicto(resumen: resumen) {
                    call.resolve(v)
                } else {
                    call.resolve(["ia": NSNull()])
                }
            } catch {
                call.reject("ia: \(error.localizedDescription)")
            }
        }
    }

    @objc func haptico(_ call: CAPPluginCall) {
        let tipo = call.getString("tipo") ?? "toque"
        DispatchQueue.main.async {
            switch tipo {
            case "exito":
                UINotificationFeedbackGenerator().notificationOccurred(.success)
            case "aviso":
                UINotificationFeedbackGenerator().notificationOccurred(.warning)
            default:
                UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            }
            call.resolve()
        }
    }

    @objc func mantenerPantalla(_ call: CAPPluginCall) {
        let activo = call.getBool("activo") ?? false
        DispatchQueue.main.async {
            UIApplication.shared.isIdleTimerDisabled = activo
            call.resolve()
        }
    }
}
