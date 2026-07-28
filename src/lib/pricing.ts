import { useDataStore } from '../stores/dataStore';
import { getProductDivision } from './utils';
import { type Product } from '../types';

/**
 * Single source of truth for resolving a product's price for a specific client.
 * Pricing Priority:
 * 1. Client Custom Price
 * 2. Product Default Price (fallback)
 */
export function resolveProductPrice(clientId: string, productId: string): number {
  if (!clientId || !productId) return 0;
  
  const { clientPricing, products } = useDataStore.getState();
  const product = products.find(p => p.id === productId);
  if (!product) return 0;
  
  // 1. Client Custom Price (Now a single flat map from dataStore)
  const clientData = clientPricing[clientId] || {};
  const custom = clientData[productId];
  
  if (custom !== undefined && custom !== null && !isNaN(Number(custom)) && Number(custom) > 0) {
    return Number(custom);
  }
  
  // 2. Product Default Price
  return (product as any).price || 0;
}
