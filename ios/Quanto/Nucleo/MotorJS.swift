import Foundation
import JavaScriptCore

/// Ejecuta en el iPhone la misma lógica que la web: el parser de etiquetas
/// (web/assets/ocr.js), los datos (web/data/store.js) y el motor de ahorro
/// (web/data/ahorro.js). `scripts/logica-ios.mjs` los junta en
/// Recursos/logica.js; aquí se cargan en un JSContext.
///
/// - Los datos viven en un localStorage en memoria que se vuelca a
///   Application Support/Quanto/datos.json después de cada cambio.
/// - Todo pasa por `QuantoLlamar(nombre, argsJSON)`: los argumentos van como
///   JSON y la respuesta vuelve como `{ "r": resultado }`.
@MainActor
final class MotorJS {

    static let compartido = MotorJS()

    static var archivoPorDefecto: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("Quanto", isDirectory: true).appendingPathComponent("datos.json")
    }

    private let contexto: JSContext
    private let archivo: URL
    private let colaGuardado = DispatchQueue(label: "quanto.motor.guardado", qos: .utility)
    private(set) var ultimoError: String?

    init(archivo: URL = MotorJS.archivoPorDefecto) {
        self.archivo = archivo
        guard let ctx = JSContext() else { fatalError("JavaScriptCore no está disponible") }
        contexto = ctx
        contexto.name = "Quanto"
        guard let url = Bundle.main.url(forResource: "logica", withExtension: "js"),
              let codigo = try? String(contentsOf: url, encoding: .utf8) else {
            fatalError("Falta logica.js en la app: corre `npm run logica:ios` y vuelve a compilar")
        }
        contexto.evaluateScript(codigo, withSourceURL: url)
        if let e = contexto.exception { fatalError("logica.js no cargó: \(e)") }
        let guardado = (try? String(contentsOf: archivo, encoding: .utf8)) ?? ""
        almacen("cargar", [guardado])
    }

    // MARK: - Llamadas

    /// Llama a una función de la lógica y devuelve el JSON de la respuesta.
    @discardableResult
    func llamar(_ funcion: String, _ args: [Any?] = []) -> Data? {
        let limpios: [Any] = args.map { v -> Any in v ?? NSNull() }
        guard JSONSerialization.isValidJSONObject(limpios),
              let datosArgs = try? JSONSerialization.data(withJSONObject: limpios),
              let textoArgs = String(data: datosArgs, encoding: .utf8) else {
            registrar("\(funcion): argumentos no serializables")
            return nil
        }
        contexto.exception = nil
        let respuesta = contexto.objectForKeyedSubscript("QuantoLlamar")?.call(withArguments: [funcion, textoArgs])
        if let e = contexto.exception {
            contexto.exception = nil
            registrar("\(funcion): \(e)")
            return nil
        }
        guardarSiHaceFalta()
        guard let texto = respuesta?.toString(), texto != "undefined" else { return nil }
        return texto.data(using: .utf8)
    }

    /// Llama y decodifica el resultado. Devuelve nil si la función devolvió null o falló.
    func valor<T: Decodable>(_ tipo: T.Type, _ funcion: String, _ args: [Any?] = []) -> T? {
        guard let datos = llamar(funcion, args) else { return nil }
        do {
            return try MotorJS.decodificador.decode(Envoltura<T>.self, from: datos).r
        } catch {
            registrar("\(funcion): no se pudo leer la respuesta (\(error))")
            return nil
        }
    }

    /// Los campos de la web vienen en snake_case (lista_id, precio_estimado).
    static let decodificador: JSONDecoder = {
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        return d
    }()

    private struct Envoltura<T: Decodable>: Decodable {
        let r: T?
    }

    private func registrar(_ mensaje: String) {
        ultimoError = mensaje
        print("Quanto · lógica JS · \(mensaje)")
    }

    // MARK: - Almacén

    @discardableResult
    private func almacen(_ metodo: String, _ args: [Any] = []) -> JSValue? {
        contexto.objectForKeyedSubscript("QuantoAlmacen")?.invokeMethod(metodo, withArguments: args)
    }

    private func guardarSiHaceFalta() {
        guard almacen("sucio")?.toBool() == true, let json = almacen("volcar")?.toString() else { return }
        let destino = archivo
        colaGuardado.async {
            do {
                try FileManager.default.createDirectory(at: destino.deletingLastPathComponent(), withIntermediateDirectories: true)
                try Data(json.utf8).write(to: destino, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            } catch {
                print("Quanto · no se pudo guardar: \(error)")
            }
        }
    }

    /// Espera a que termine la última escritura (al pasar a segundo plano).
    func esperarGuardado() {
        colaGuardado.sync { }
    }
}
