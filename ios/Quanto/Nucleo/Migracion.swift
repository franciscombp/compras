import Foundation
import WebKit

/// Trae los datos de la versión anterior de la app (la web dentro de
/// Capacitor). Esa versión guardaba todo en el localStorage del WebView, en el
/// origen capacitor://localhost. Como la app nueva conserva el mismo
/// identificador (app.quanto.compras), ese almacenamiento sigue en el
/// iPhone: se abre un WebView invisible en el mismo origen, se leen las
/// claves "justo:*" y se fusionan por id con lo que haya.
@MainActor
final class MigracionWeb: NSObject, WKNavigationDelegate, WKURLSchemeHandler {

    static let claveHecha = "quanto.migracionWebHecha"

    private var vista: WKWebView?
    private var continuacion: CheckedContinuation<[String: String]?, Never>?

    /// Al primer arranque. Devuelve lo importado, o nil si no había nada.
    static func alArrancar(_ datos: Datos) async -> ResultadoImportacion? {
        guard !UserDefaults.standard.bool(forKey: claveHecha) else { return nil }
        let r = await traer(datos)
        UserDefaults.standard.set(true, forKey: claveHecha)
        return r
    }

    /// También desde Ajustes, si la persona lo pide de nuevo.
    static func traer(_ datos: Datos) async -> ResultadoImportacion? {
        let lector = MigracionWeb()
        guard let crudo = await lector.leer(), !crudo.isEmpty,
              let r = datos.importarDesdeWeb(crudo), r.vacio != true else { return nil }
        return r
    }

    private func leer() async -> [String: String]? {
        await withCheckedContinuation { (cont: CheckedContinuation<[String: String]?, Never>) in
            continuacion = cont
            let config = WKWebViewConfiguration()
            config.websiteDataStore = .default()
            config.setURLSchemeHandler(self, forURLScheme: "capacitor")
            let v = WKWebView(frame: .zero, configuration: config)
            v.navigationDelegate = self
            vista = v
            v.load(URLRequest(url: URL(string: "capacitor://localhost/")!))
            Task { [weak self] in
                try? await Task.sleep(for: .seconds(8))
                self?.terminar(nil)
            }
        }
    }

    private func terminar(_ resultado: [String: String]?) {
        guard let c = continuacion else { return }
        continuacion = nil
        vista?.navigationDelegate = nil
        vista = nil
        c.resume(returning: resultado)
    }

    // MARK: - Página vacía en capacitor://localhost

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        let html = Data("<!doctype html><meta charset=utf-8><title>Quanto</title>".utf8)
        let url = urlSchemeTask.request.url ?? URL(string: "capacitor://localhost/")!
        let respuesta = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1",
                                        headerFields: ["Content-Type": "text/html; charset=utf-8"])!
        urlSchemeTask.didReceive(respuesta)
        urlSchemeTask.didReceive(html)
        urlSchemeTask.didFinish()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}

    // MARK: - Navegación

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        let js = """
        JSON.stringify(Object.keys(localStorage).filter(function (k) { return k.indexOf("justo:") === 0; })
          .reduce(function (o, k) { o[k] = localStorage.getItem(k); return o; }, {}))
        """
        Task {
            let r = try? await webView.evaluateJavaScript(js)
            guard let texto = r as? String, let d = texto.data(using: .utf8),
                  let obj = try? JSONSerialization.jsonObject(with: d) as? [String: String] else {
                terminar(nil)
                return
            }
            terminar(obj)
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        terminar(nil)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        terminar(nil)
    }
}
