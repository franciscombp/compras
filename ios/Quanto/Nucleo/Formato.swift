import Foundation

/// Formatos de precio y medidas, como en la web (fmt, fmtNorm).
enum Formato {

    /// "$1.25"
    static func precio(_ v: Double?) -> String {
        guard let v = v else { return "—" }
        return String(format: "$%.2f", v)
    }

    /// Precio por 100 g/ml: tres decimales bajo $1 ("$0.125").
    static func normalizado(_ v: Double?) -> String {
        guard let v = v else { return "—" }
        return String(format: v < 1 ? "$%.3f" : "$%.2f", v)
    }

    /// "100 g", "100 ml" o "u" según la unidad.
    static func base(_ unidad: String?) -> String {
        switch unidad {
        case "unidad": return "u"
        case "ml": return "100 ml"
        default: return "100 g"
        }
    }

    static func porcentaje(_ v: Double) -> String {
        "\(Int((abs(v) * 100).rounded()))%"
    }

    /// "500 g", "1 L", "1.5 kg", "6 u"
    static func contenido(_ c: Double?, _ unidad: String?) -> String? {
        guard let c = c, c > 0 else { return nil }
        switch unidad {
        case "ml": return c >= 1000 ? "\(numero(c / 1000)) L" : "\(numero(c)) ml"
        case "unidad": return "\(numero(c)) u"
        default: return c >= 1000 ? "\(numero(c / 1000)) kg" : "\(numero(c)) g"
        }
    }

    static func numero(_ v: Double) -> String {
        v.rounded() == v ? String(Int(v)) : String(format: "%.2f", v).replacingOccurrences(of: #"\.?0+$"#, with: "", options: .regularExpression)
    }

    static func fecha(_ d: Date) -> String {
        d.formatted(.dateTime.day().month(.abbreviated).year())
    }

    static func relativa(_ d: Date) -> String {
        d.formatted(.relative(presentation: .named))
    }

    /// "3,50", "3.50", "$3" -> 3.5
    static func leerNumero(_ texto: String) -> Double? {
        let limpio = texto.replacingOccurrences(of: "$", with: "")
            .replacingOccurrences(of: ",", with: ".")
            .trimmingCharacters(in: .whitespaces)
        guard let v = Double(limpio), v.isFinite, v >= 0 else { return nil }
        return v
    }

    static func texto(_ v: Double?) -> String {
        guard let v = v, v > 0 else { return "" }
        return numero(v)
    }
}

/// Unidades que se pueden escribir; se guardan en g, ml o unidad.
enum UnidadEntrada: String, CaseIterable, Identifiable {
    case g, kg, ml, l, u

    var id: String { rawValue }

    var etiqueta: String {
        switch self {
        case .g: return "g"
        case .kg: return "kg"
        case .ml: return "ml"
        case .l: return "L"
        case .u: return "u"
        }
    }

    var base: String {
        switch self {
        case .g, .kg: return "g"
        case .ml, .l: return "ml"
        case .u: return "unidad"
        }
    }

    var factor: Double {
        switch self {
        case .kg, .l: return 1000
        default: return 1
        }
    }

    /// La entrada más cómoda para un contenido guardado ("1000 ml" -> 1 L).
    static func desde(contenido: Double?, unidad: String?) -> (UnidadEntrada, Double?) {
        guard let c = contenido, c > 0 else {
            return (unidad == "ml" ? .ml : unidad == "unidad" ? .u : .g, nil)
        }
        switch unidad {
        case "ml": return c >= 1000 && (c / 1000).rounded() == c / 1000 ? (.l, c / 1000) : (.ml, c)
        case "unidad": return (.u, c)
        default: return c >= 1000 && (c / 1000).rounded() == c / 1000 ? (.kg, c / 1000) : (.g, c)
        }
    }
}
