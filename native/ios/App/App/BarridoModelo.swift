import Foundation
import AVFoundation
import Vision
import CoreImage
import UIKit
import Combine

/// Cámara nativa del barrido: AVCaptureSession -> Vision por fotograma ->
/// EtiquetasVivo/SeguimientoVivo -> estado publicado para el overlay SwiftUI.
/// Cada etiqueta confirmada se entrega a la web (texto, palabras con caja,
/// miniatura); la web devuelve el precio por 100 g y el ganador para pintar.
final class BarridoModelo: NSObject, ObservableObject, AVCaptureVideoDataOutputSampleBufferDelegate {

    struct Vista: Identifiable {
        let id: String
        let caja: Caja
        let precio: Double
        let confirmada: Bool
    }

    struct Chip {
        let texto: String
        let estado: String // "mejor" | "ok" | "sinGramaje"
    }

    @Published var vistas: [Vista] = []
    @Published var chips: [String: Chip] = [:]
    @Published var pausado = false
    @Published var linterna = false
    @Published var estado = "Buscando etiquetas de precio…"
    @Published var contador = 0
    @Published var sinPermiso = false

    var alConfirmar: (([String: Any]) -> Void)?
    var alTocar: ((String) -> Void)?
    var alCerrar: (() -> Void)?

    let sesion = AVCaptureSession()
    let capaPreview: AVCaptureVideoPreviewLayer
    private let colaVideo = DispatchQueue(label: "quanto.barrido.video", qos: .userInitiated)
    private let colaSesion = DispatchQueue(label: "quanto.barrido.sesion")
    private let seguimiento = SeguimientoVivo(confirmarTras: 2, olvidar: 1.5)
    private let contextoCI = CIContext(options: [.useSoftwareRenderer: false])
    private var dispositivo: AVCaptureDevice?
    private var ocupado = false
    private var nivelRapido = false
    private var lentos = 0
    private var dimensiones = CGSize(width: 1080, height: 1920)
    private var ultimaPublicacion: TimeInterval = 0

    override init() {
        capaPreview = AVCaptureVideoPreviewLayer(session: sesion)
        capaPreview.videoGravity = .resizeAspectFill
        super.init()
    }

    // MARK: - Ciclo de vida

    func iniciar() {
        AVCaptureDevice.requestAccess(for: .video) { [weak self] ok in
            guard let self = self else { return }
            if !ok { DispatchQueue.main.async { self.sinPermiso = true }; return }
            self.colaSesion.async {
                self.configurar()
                self.sesion.startRunning()
            }
            DispatchQueue.main.async { UIApplication.shared.isIdleTimerDisabled = true }
        }
    }

    func detener() {
        colaSesion.async { [sesion] in if sesion.isRunning { sesion.stopRunning() } }
        DispatchQueue.main.async { UIApplication.shared.isIdleTimerDisabled = false }
        apagarLinterna()
    }

    private func configurar() {
        sesion.beginConfiguration()
        sesion.sessionPreset = sesion.canSetSessionPreset(.hd1920x1080) ? .hd1920x1080 : .high
        guard let dev = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
              let input = try? AVCaptureDeviceInput(device: dev), sesion.canAddInput(input) else {
            sesion.commitConfiguration()
            return
        }
        dispositivo = dev
        sesion.addInput(input)
        if (try? dev.lockForConfiguration()) != nil {
            if dev.isFocusModeSupported(.continuousAutoFocus) { dev.focusMode = .continuousAutoFocus }
            if dev.isExposureModeSupported(.continuousAutoExposure) { dev.exposureMode = .continuousAutoExposure }
            dev.unlockForConfiguration()
        }
        let salida = AVCaptureVideoDataOutput()
        salida.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
        salida.alwaysDiscardsLateVideoFrames = true
        salida.setSampleBufferDelegate(self, queue: colaVideo)
        if sesion.canAddOutput(salida) { sesion.addOutput(salida) }
        // Buffers ya en vertical: Vision trabaja con .up y el mapeo al overlay es directo.
        if let c = salida.connection(with: .video), c.isVideoRotationAngleSupported(90) { c.videoRotationAngle = 90 }
        if let c = capaPreview.connection, c.isVideoRotationAngleSupported(90) { c.videoRotationAngle = 90 }
        sesion.commitConfiguration()
    }

    // MARK: - Controles

    func alternarPausa() {
        pausado.toggle()
        estado = pausado ? "En pausa: toca una etiqueta para agregarla o revisarla." : resumen()
    }

    func alternarLinterna() {
        guard let d = dispositivo, d.hasTorch else { return }
        do {
            try d.lockForConfiguration()
            d.torchMode = d.torchMode == .on ? .off : .on
            linterna = d.torchMode == .on
            d.unlockForConfiguration()
        } catch { }
    }

    private func apagarLinterna() {
        guard let d = dispositivo, d.hasTorch, d.torchMode == .on, (try? d.lockForConfiguration()) != nil else { return }
        d.torchMode = .off
        d.unlockForConfiguration()
    }

    /// Enfoque por toque: el punto llega en coordenadas de la capa de preview.
    func enfocar(en punto: CGPoint) {
        guard let d = dispositivo, d.isFocusPointOfInterestSupported else { return }
        let p = capaPreview.captureDevicePointConverted(fromLayerPoint: punto)
        guard (try? d.lockForConfiguration()) != nil else { return }
        d.focusPointOfInterest = p
        d.focusMode = .autoFocus
        if d.isExposurePointOfInterestSupported { d.exposurePointOfInterest = p; d.exposureMode = .continuousAutoExposure }
        d.unlockForConfiguration()
    }

    /// Toque sobre el overlay: confirma una etiqueta aún no confirmada o avisa a la web de una confirmada.
    func tocar(_ punto: CGPoint, tamano: CGSize) {
        let candidata = vistas.first { v in
            let r = rectEnPantalla(v.caja, tamano: tamano).insetBy(dx: -8, dy: -30)
            return r.contains(punto)
        }
        guard let v = candidata else { enfocar(en: punto); return }
        if v.confirmada {
            alTocar?(v.id)
            return
        }
        colaVideo.async { [weak self] in
            guard let self = self, let p = self.seguimiento.confirmar(id: v.id) else { return }
            self.entregar(p, pixelBuffer: nil)
        }
    }

    func rectEnPantalla(_ c: Caja, tamano: CGSize) -> CGRect {
        let escala = max(tamano.width / dimensiones.width, tamano.height / dimensiones.height)
        let w = dimensiones.width * escala, h = dimensiones.height * escala
        let offX = (tamano.width - w) / 2, offY = (tamano.height - h) / 2
        return CGRect(x: offX + c.x0 * w, y: offY + c.y0 * h, width: c.ancho * w, height: c.alto * h)
    }

    func actualizarChips(_ nuevos: [String: Chip]) {
        chips = nuevos
        estado = resumen()
    }

    private func resumen() -> String {
        let mejor = chips.values.first { $0.estado == "mejor" }
        if let m = mejor { return "\(contador) etiquetas · conviene \(m.texto)" }
        if contador == 1 { return "1 etiqueta · sigue hasta la siguiente para comparar" }
        if contador > 1 { return "\(contador) etiquetas · falta el gramaje de alguna: tócala" }
        return vistas.isEmpty ? "Buscando etiquetas de precio…" : "Etiqueta a la vista… mantén un instante"
    }

    // MARK: - Fotogramas

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard !pausado, !ocupado, let pb = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        ocupado = true
        defer { ocupado = false }

        let w = CVPixelBufferGetWidth(pb), h = CVPixelBufferGetHeight(pb)
        if dimensiones.width != CGFloat(w) || dimensiones.height != CGFloat(h) {
            let d = CGSize(width: w, height: h)
            DispatchQueue.main.async { self.dimensiones = d }
            dimensiones = d
        }

        let req = VNRecognizeTextRequest()
        req.recognitionLevel = nivelRapido ? .fast : .accurate
        req.recognitionLanguages = ["es-ES", "en-US"]
        req.usesLanguageCorrection = true
        let t0 = CACurrentMediaTime()
        let handler = VNImageRequestHandler(cvPixelBuffer: pb, orientation: .up, options: [:])
        guard (try? handler.perform([req])) != nil else { return }
        let duracion = CACurrentMediaTime() - t0
        if duracion > 1.2 && !nivelRapido { lentos += 1; if lentos >= 2 { nivelRapido = true } }

        let lineas: [LineaOCR] = (req.results ?? []).compactMap { obs in
            guard let cand = obs.topCandidates(1).first else { return nil }
            let texto = cand.string
            var palabras: [PalabraOCR] = []
            var inicio = texto.startIndex
            for palabra in texto.split(separator: " ") {
                guard let rango = texto.range(of: String(palabra), range: inicio..<texto.endIndex) else { continue }
                inicio = rango.upperBound
                let r = (try? cand.boundingBox(for: rango))?.boundingBox ?? obs.boundingBox
                palabras.append(PalabraOCR(text: String(palabra), caja: Caja(vision: r)))
            }
            return LineaOCR(text: texto, caja: Caja(vision: obs.boundingBox), visionRect: obs.boundingBox, palabras: palabras)
        }

        let regiones = EtiquetasVivo.agrupar(lineas)
        let ahora = CACurrentMediaTime()
        let (visibles, nuevas) = seguimiento.actualizar(regiones, ahora: ahora)
        for p in nuevas { entregar(p, pixelBuffer: pb) }

        let lista = visibles.map { Vista(id: $0.id, caja: $0.caja, precio: $0.region.precio, confirmada: $0.confirmada) }
        if ahora - ultimaPublicacion > 0.05 || !nuevas.isEmpty {
            ultimaPublicacion = ahora
            DispatchQueue.main.async {
                self.vistas = lista
                if self.chips.isEmpty && self.contador == 0 { self.estado = self.resumen() }
            }
        }
    }

    /// Entrega una etiqueta confirmada a la web con su miniatura.
    private func entregar(_ p: SeguimientoVivo.Pista, pixelBuffer: CVPixelBuffer?) {
        let r = p.region
        let w = Double(dimensiones.width), h = Double(dimensiones.height)
        let palabras: [[String: Any]] = r.palabras.map {
            ["text": $0.text, "bbox": ["x0": $0.caja.x0 * w, "y0": $0.caja.y0 * h, "x1": $0.caja.x1 * w, "y1": $0.caja.y1 * h]]
        }
        var datos: [String: Any] = [
            "id": p.id,
            "texto": r.texto,
            "precio": r.precio,
            "lineas": r.lineas.map(\.text),
            "palabras": palabras,
            "caja": ["x0": r.caja.x0, "y0": r.caja.y0, "x1": r.caja.x1, "y1": r.caja.y1],
        ]
        if let pb = pixelBuffer, let mini = miniatura(pb, rect: r.visionRect) { datos["miniatura"] = mini }
        DispatchQueue.main.async {
            self.contador += 1
            self.estado = "Agregada: $\(String(format: "%.2f", r.precio))"
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            self.alConfirmar?(datos)
        }
    }

    private func miniatura(_ pb: CVPixelBuffer, rect visionRect: CGRect) -> String? {
        let ci = CIImage(cvPixelBuffer: pb)
        let ext = ci.extent
        var r = CGRect(x: visionRect.minX * ext.width, y: visionRect.minY * ext.height,
                       width: visionRect.width * ext.width, height: visionRect.height * ext.height)
        let pad = max(8, r.height * 0.25)
        r = r.insetBy(dx: -pad, dy: -pad).intersection(ext)
        guard !r.isEmpty, let cg = contextoCI.createCGImage(ci.cropped(to: r), from: r) else { return nil }
        let img = UIImage(cgImage: cg)
        let lado: CGFloat = 220
        let escala = min(1, lado / max(img.size.width, 1))
        let tam = CGSize(width: img.size.width * escala, height: img.size.height * escala)
        let render = UIGraphicsImageRenderer(size: tam)
        let chica = render.image { _ in img.draw(in: CGRect(origin: .zero, size: tam)) }
        guard let jpeg = chica.jpegData(compressionQuality: 0.6) else { return nil }
        return "data:image/jpeg;base64," + jpeg.base64EncodedString()
    }
}
