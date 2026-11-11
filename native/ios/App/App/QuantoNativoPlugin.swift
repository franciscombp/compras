import Foundation
import Capacitor
import UIKit

/// Puente entre la web de Quanto y las capacidades del iPhone.
/// La web habla con `window.Capacitor.Plugins.QuantoNativo` a través de
/// data/nativo.js; en Android o web ese módulo usa otras implementaciones.
///
/// Métodos:
///   capacidades()                       -> { vision, codigoBarras, appleIntelligence, plataforma }
///   leerEtiqueta({ imagen, ia, rapido }) -> { texto, lineas, palabras, codigo, ia, iaEstado }
///   interpretarEtiqueta({ texto })      -> datos de la etiqueta | { ia: null }
///   interpretarProducto({ frase })      -> { nombre, cantidad, precio, contenido, unidad } | { ia: null }
///   explicarComparacion({ resumen })    -> { titulo, explicacion } | { ia: null }
///   redactarConsejo({ resumen })        -> { titulo, consejo } | { ia: null }
///   haptico({ tipo })                   -> tipo: "exito" | "aviso" | "toque"
///   mantenerPantalla({ activo })
///   exportarRecordatorios({ lista, items: [{ nombre, nota }] }) -> { creados, omitidos }
///   importarRecordatorios({ lista? })   -> { items: [{ nombre, nota, lista }] }
///   compartir({ texto, titulo })        -> { completado, actividad }
///   abrirBarrido() / cerrarBarrido()    -> cámara nativa a pantalla completa (BarridoView)
///   actualizarEtiquetas({ etiquetas: [{ id, chip, estado }] }) -> textos del overlay
///   Eventos: barridoEtiqueta { id, texto, precio, lineas, palabras, caja, miniatura },
///            barridoToque { id }, barridoCerrado { motivo }
@objc(QuantoNativoPlugin)
public class QuantoNativoPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "QuantoNativoPlugin"
    public let jsName = "QuantoNativo"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "capacidades", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "leerEtiqueta", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "interpretarEtiqueta", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "interpretarProducto", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "explicarComparacion", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "redactarConsejo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "haptico", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "mantenerPantalla", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "exportarRecordatorios", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "importarRecordatorios", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "compartir", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "abrirBarrido", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cerrarBarrido", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "actualizarEtiquetas", returnType: CAPPluginReturnPromise),
    ]

    private var barridoHost: BarridoHost?
    private var barridoModelo: BarridoModelo?

    public override func load() {
        AppleIA.precalentar()
    }

    @objc func capacidades(_ call: CAPPluginCall) {
        call.resolve([
            "vision": true,
            "codigoBarras": true,
            "barrido": true,
            "barridoNativo": true,
            "recordatorios": true,
            "compartir": true,
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
        let rapido = call.getBool("rapido") ?? false

        DispatchQueue.global(qos: .userInitiated).async {
            let lectura: LectorEtiqueta.Lectura
            do {
                lectura = try LectorEtiqueta.leer(cg, rapido: rapido)
            } catch {
                call.reject("vision: \(error.localizedDescription)")
                return
            }

            var resultado: [String: Any] = [
                "texto": lectura.texto,
                "lineas": lectura.lineas,
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

    @objc func interpretarEtiqueta(_ call: CAPPluginCall) {
        let texto = (call.getString("texto") ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !texto.isEmpty else { call.reject("texto_vacio"); return }
        Task {
            do {
                if let e = try await AppleIA.etiqueta(texto: texto) {
                    call.resolve(e)
                } else {
                    call.resolve(["ia": NSNull()])
                }
            } catch {
                call.reject("ia: \(error.localizedDescription)")
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

    @objc func redactarConsejo(_ call: CAPPluginCall) {
        let resumen = (call.getString("resumen") ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !resumen.isEmpty else { call.reject("resumen_vacio"); return }
        Task {
            do {
                if let c = try await AppleIA.consejo(resumen: resumen) {
                    call.resolve(c)
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

    // MARK: - Recordatorios (la lista de compras de Apple)

    @objc func exportarRecordatorios(_ call: CAPPluginCall) {
        let lista = (call.getString("lista") ?? "Quanto").trimmingCharacters(in: .whitespacesAndNewlines)
        let items = (call.getArray("items") as? [[String: Any]] ?? []).compactMap { d -> Recordatorios.Item? in
            guard let nombre = d["nombre"] as? String, !nombre.isEmpty else { return nil }
            return Recordatorios.Item(nombre: nombre, nota: d["nota"] as? String)
        }
        guard !items.isEmpty else { call.reject("sin_items"); return }
        Task {
            do {
                let r = try await Recordatorios.exportar(lista: lista.isEmpty ? "Quanto" : lista, items: items)
                call.resolve(["creados": r.creados, "omitidos": r.omitidos])
            } catch Recordatorios.Fallo.sinPermiso {
                call.reject("sin_permiso")
            } catch {
                call.reject("recordatorios: \(error.localizedDescription)")
            }
        }
    }

    @objc func importarRecordatorios(_ call: CAPPluginCall) {
        let lista = call.getString("lista")
        Task {
            do {
                let items = try await Recordatorios.pendientes(lista: lista)
                call.resolve(["items": items.map { ["nombre": $0.nombre, "nota": $0.nota ?? NSNull(), "lista": $0.lista ?? NSNull()] }])
            } catch Recordatorios.Fallo.sinPermiso {
                call.reject("sin_permiso")
            } catch {
                call.reject("recordatorios: \(error.localizedDescription)")
            }
        }
    }

    // MARK: - Barrido nativo (SwiftUI + AVFoundation + Vision)

    @objc func abrirBarrido(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let vc = self.bridge?.viewController else { call.reject("sin_vista"); return }
            if self.barridoHost != nil { call.resolve(["yaAbierto": true]); return }
            let modelo = BarridoModelo()
            modelo.alConfirmar = { [weak self] datos in self?.notifyListeners("barridoEtiqueta", data: datos) }
            modelo.alTocar = { [weak self] id in self?.notifyListeners("barridoToque", data: ["id": id]) }
            modelo.alCerrar = { [weak self] in self?.cerrarBarridoInterno(motivo: "usuario") }
            let host = BarridoHost(rootView: BarridoView(modelo: modelo))
            host.modalPresentationStyle = .fullScreen
            self.barridoHost = host
            self.barridoModelo = modelo
            vc.present(host, animated: true) { call.resolve(["yaAbierto": false]) }
        }
    }

    @objc func cerrarBarrido(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.cerrarBarridoInterno(motivo: "web")
            call.resolve()
        }
    }

    private func cerrarBarridoInterno(motivo: String) {
        guard let host = barridoHost else { return }
        barridoModelo?.detener()
        host.dismiss(animated: true)
        barridoHost = nil
        barridoModelo = nil
        notifyListeners("barridoCerrado", data: ["motivo": motivo])
    }

    @objc func actualizarEtiquetas(_ call: CAPPluginCall) {
        let lista = (call.getArray("etiquetas") as? [[String: Any]]) ?? []
        var chips: [String: BarridoModelo.Chip] = [:]
        for e in lista {
            guard let id = e["id"] as? String, let chip = e["chip"] as? String else { continue }
            chips[id] = BarridoModelo.Chip(texto: chip, estado: (e["estado"] as? String) ?? "ok")
        }
        DispatchQueue.main.async {
            self.barridoModelo?.actualizarChips(chips)
            call.resolve()
        }
    }

    // MARK: - Compartir (Notas, Mensajes, WhatsApp...)

    @objc func compartir(_ call: CAPPluginCall) {
        let texto = call.getString("texto") ?? ""
        guard !texto.isEmpty else { call.reject("sin_texto"); return }
        DispatchQueue.main.async {
            guard let vc = self.bridge?.viewController else { call.reject("sin_vista"); return }
            let hoja = UIActivityViewController(activityItems: [texto], applicationActivities: nil)
            hoja.completionWithItemsHandler = { actividad, completado, _, _ in
                call.resolve(["completado": completado, "actividad": actividad?.rawValue ?? NSNull()])
            }
            if let pop = hoja.popoverPresentationController {
                pop.sourceView = vc.view
                pop.sourceRect = CGRect(x: vc.view.bounds.midX, y: vc.view.bounds.maxY - 80, width: 1, height: 1)
            }
            vc.present(hoja, animated: true)
        }
    }
}
