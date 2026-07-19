/**
 * API Layer — Gesiona todas las conexiones externas
 * Preparado para: productAPIs, barcode, scrapers, etc.
 */

const API_CONFIG = {
  timeout: 5000,
  retries: 2,
  baseURL: '',
};

class APIClient {
  constructor(config = {}) {
    this.config = { ...API_CONFIG, ...config };
  }

  async fetch(url, options = {}) {
    const fullUrl = this.config.baseURL + url;
    try {
      const response = await fetch(fullUrl, {
        ...options,
        signal: AbortSignal.timeout(this.config.timeout),
      });
      if (!response.ok) throw new Error(`API Error: ${response.status}`);
      return response.json();
    } catch (error) {
      console.error('API Error:', error);
      return null;
    }
  }
}

// Servicios específicos
export const services = {
  // Buscar producto por código de barras (preparado para API futura)
  async searchByBarcode(barcode) {
    // Ejemplo: return await apiClient.fetch(`/products/barcode/${barcode}`);
    return null; // Por ahora, offline
  },

  // Obtener datos de productos (para scraping futuro)
  async searchProduct(nombre) {
    // Ejemplo: return await apiClient.fetch(`/products/search?q=${nombre}`);
    return null; // Por ahora, offline
  },

  // Comparador online (futuro)
  async compareOnline(productos) {
    // Enviará lista a servidor para análisis avanzado
    return null;
  },

  // Sync de datos (futuro)
  async syncData(items) {
    // Sincronizará datos con servidor
    return null;
  }
};

// Helper para detectar conexión
export function tieneConexion() {
  return navigator.onLine;
}
