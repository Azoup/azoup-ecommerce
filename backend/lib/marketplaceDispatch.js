import {
  compareCatalog as compareNuvemshopCatalog,
  importFromNuvemshop,
  exportToNuvemshop,
  syncStock as syncNuvemshopStock,
  syncProductPrices as syncNuvemshopPrices,
  syncProductSkus as syncNuvemshopSkus,
  resolveIntegration,
  getOrderImportStatusDefinitions as getNuvemshopOrderImportStatusDefinitions,
  disconnectIntegration,
  getIntegration,
  getIntegrationStatus,
  updateIntegrationSettings,
  saveIntegration,
  listIntegrations as listIntegrationsFromDb,
} from './marketplaceSync.js';
import {
  compareTrayCatalog,
  importFromTray,
  exportToTray,
  syncTrayStock,
} from './marketplaceTraySync.js';
import { getTrayImportStatusDefinitions } from './trayOrderStatuses.js';
import { isTrayIntegrationEnabled } from './trayConfig.js';
import {
  syncAndListOrders as syncNuvemshopOrders,
  listStoredOrders,
  getMarketplaceOrderDetail,
} from './marketplaceOrderSync.js';

async function resolveMarketplaceIntegration(clienteId, integracaoId) {
  const integration = await resolveIntegration(clienteId, integracaoId);
  if (integration?.marketplace === 'tray' && !isTrayIntegrationEnabled()) {
    throw new Error('Integração Tray temporariamente desabilitada.');
  }
  return integration;
}

export async function listIntegrations(clienteId) {
  const rows = await listIntegrationsFromDb(clienteId);
  if (isTrayIntegrationEnabled()) return rows;
  return rows.filter((row) => row.marketplace !== 'tray');
}

export async function compareCatalog(clienteId, options = {}) {
  const integration = await resolveMarketplaceIntegration(clienteId, options.integracaoId);
  if (integration.marketplace === 'tray') {
    return compareTrayCatalog(clienteId, options);
  }
  return compareNuvemshopCatalog(clienteId, options);
}

export async function importProducts(clienteId, importRequests, options = {}) {
  const integration = await resolveMarketplaceIntegration(clienteId, options.integracaoId);
  if (integration.marketplace === 'tray') {
    return importFromTray(clienteId, importRequests, options);
  }
  return importFromNuvemshop(clienteId, importRequests, options);
}

export async function exportProducts(clienteId, exportRequests, options = {}) {
  const integration = await resolveMarketplaceIntegration(clienteId, options.integracaoId);
  if (integration.marketplace === 'tray') {
    return exportToTray(clienteId, exportRequests, options);
  }
  return exportToNuvemshop(clienteId, exportRequests, options);
}

export async function syncStock(clienteId, items, options = {}) {
  const integration = await resolveMarketplaceIntegration(clienteId, options.integracaoId);
  if (integration.marketplace === 'tray') {
    return syncTrayStock(clienteId, items, options);
  }
  return syncNuvemshopStock(clienteId, items, options);
}

export async function syncProductPrices(clienteId, options = {}) {
  const integration = await resolveMarketplaceIntegration(clienteId, options.integracaoId);
  if (integration.marketplace === 'tray') {
    return { results: [], skipped: true, reason: 'tray_price_sync_not_implemented' };
  }
  return syncNuvemshopPrices(clienteId, options);
}

export async function syncProductSkus(clienteId, options = {}) {
  const integration = await resolveMarketplaceIntegration(clienteId, options.integracaoId);
  if (integration.marketplace === 'tray') {
    return { results: [], skipped: true, reason: 'tray_sku_sync_not_implemented' };
  }
  return syncNuvemshopSkus(clienteId, options);
}

export async function syncOrders(clienteId, options = {}) {
  return syncNuvemshopOrders(clienteId, options);
}

export function getOrderImportStatusDefinitions(marketplace = 'nuvemshop') {
  if (marketplace === 'tray') {
    if (!isTrayIntegrationEnabled()) return getNuvemshopOrderImportStatusDefinitions();
    return getTrayImportStatusDefinitions();
  }
  return getNuvemshopOrderImportStatusDefinitions();
}

export {
  listStoredOrders,
  getMarketplaceOrderDetail,
  disconnectIntegration,
  getIntegration,
  getIntegrationStatus,
  updateIntegrationSettings,
  saveIntegration,
};
