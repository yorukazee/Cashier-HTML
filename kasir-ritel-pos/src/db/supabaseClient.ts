import { createClient } from '@supabase/supabase-js';
import { db } from './localDb';
import type { Product } from '../types/pos';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);
export const supabase = isSupabaseConfigured ? createClient(supabaseUrl, supabaseAnonKey) : null;

export async function syncProductToCloud(product: Product) {
  if (!supabase || !navigator.onLine) return;
  await supabase.from('products').upsert({
    id: product.id,
    barcode: product.barcode,
    name: product.name,
    category: product.category,
    cost_price: product.costPrice,
    sell_price: product.sellPrice,
    stock: product.stock,
    updated_at: new Date().toISOString()
  });
}

export async function deleteProductFromCloud(productId: string) {
  if (!supabase || !navigator.onLine) return;
  await supabase.from('products').delete().eq('id', productId);
}

export async function syncPendingTransactions() {
  if (!supabase || !navigator.onLine) return;

  const unsynced = await db.transactions.filter((t) => !t.synced).toArray();
  if (unsynced.length === 0) return;

  for (const trx of unsynced) {
    const { error } = await supabase.from('transactions').upsert({
      id: trx.id,
      timestamp: trx.timestamp,
      items: trx.items,
      subtotal: trx.subtotal,
      discount_amount: trx.discountAmount,
      total_revenue: trx.totalRevenue,
      total_profit: trx.totalProfit,
      payment_method: trx.paymentMethod,
      cash_amount: trx.cashAmount,
      non_cash_amount: trx.nonCashAmount,
      cash_received: trx.cashReceived,
      change: trx.change,
      ref_code: trx.refCode,
      is_voided: trx.isVoided
    });

    if (!error) {
      await db.transactions.update(trx.id, { synced: true });
    }
  }
}