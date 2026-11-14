import UIKit
import Capacitor

/// Controlador raíz de la app: la misma web de Quanto dentro de WKWebView,
/// con el plugin nativo de lectura de etiquetas registrado en el puente.
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(QuantoNativoPlugin())
    }
}
