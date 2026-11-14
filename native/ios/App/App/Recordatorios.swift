import Foundation
import EventKit

/// Puente con la app Recordatorios: la lista de compras de Apple.
/// - exportar: crea (o reutiliza) una lista con el nombre de la lista de
///   Quanto y añade un recordatorio por item, sin duplicar los pendientes.
/// - pendientes: lee los recordatorios no completados (de una lista o de todas)
///   para traerlos a Quanto.
/// Notas no tiene API pública: para Notas se usa la hoja de compartir.
enum Recordatorios {

    struct Item {
        var nombre: String
        var nota: String?
        var lista: String? = nil
    }

    enum Fallo: Error { case sinPermiso, sinFuente }

    private static let store = EKEventStore()

    private static func pedirAcceso() async throws -> Bool {
        if #available(iOS 17.0, *) {
            return try await store.requestFullAccessToReminders()
        } else {
            return try await store.requestAccess(to: .reminder)
        }
    }

    private static func lista(titulo: String, crear: Bool) throws -> EKCalendar? {
        let existentes = store.calendars(for: .reminder)
        if let c = existentes.first(where: { $0.title.caseInsensitiveCompare(titulo) == .orderedSame }) { return c }
        guard crear else { return nil }
        let c = EKCalendar(for: .reminder, eventStore: store)
        c.title = titulo
        guard let fuente = store.defaultCalendarForNewReminders()?.source
                ?? store.sources.first(where: { $0.sourceType == .calDAV })
                ?? store.sources.first(where: { $0.sourceType == .local }) else { throw Fallo.sinFuente }
        c.source = fuente
        try store.saveCalendar(c, commit: true)
        return c
    }

    private static func recordatorios(en calendarios: [EKCalendar]?) async -> [EKReminder] {
        let pred = store.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: calendarios)
        return await withCheckedContinuation { cont in
            store.fetchReminders(matching: pred) { cont.resume(returning: $0 ?? []) }
        }
    }

    static func exportar(lista titulo: String, items: [Item]) async throws -> (creados: Int, omitidos: Int) {
        guard try await pedirAcceso() else { throw Fallo.sinPermiso }
        guard let cal = try lista(titulo: titulo, crear: true) else { throw Fallo.sinFuente }
        let yaEstan = Set(await recordatorios(en: [cal]).compactMap { $0.title?.lowercased() })
        var creados = 0, omitidos = 0
        for it in items {
            if yaEstan.contains(it.nombre.lowercased()) { omitidos += 1; continue }
            let r = EKReminder(eventStore: store)
            r.title = it.nombre
            r.notes = it.nota
            r.calendar = cal
            try store.save(r, commit: false)
            creados += 1
        }
        if creados > 0 { try store.commit() }
        return (creados, omitidos)
    }

    static func pendientes(lista titulo: String?) async throws -> [Item] {
        guard try await pedirAcceso() else { throw Fallo.sinPermiso }
        var calendarios: [EKCalendar]? = nil
        if let titulo = titulo, let cal = try lista(titulo: titulo, crear: false) { calendarios = [cal] }
        return await recordatorios(en: calendarios)
            .sorted { ($0.creationDate ?? .distantPast) > ($1.creationDate ?? .distantPast) }
            .compactMap { r in
                guard let t = r.title?.trimmingCharacters(in: .whitespacesAndNewlines), !t.isEmpty else { return nil }
                return Item(nombre: t, nota: r.notes, lista: r.calendar?.title)
            }
    }
}
