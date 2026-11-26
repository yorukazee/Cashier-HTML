import { createClient } from '@supabase/supabase-js';
import { db } from './localDb';
import type { Product, StoreSettings, CashDrawer } from '../types/pos';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);
export const supabase = isSupabaseConfigured ? createClient(supabaseUrl, supabaseAnonKey) : null;

export interface CloudStoreConfig {
  storeSettings?: StoreSettings;
  ownerPassHash?: string;
  cashDrawer?: CashDrawer;
}

export async function fetchStoreConfigFromCloud(userId: string): Promise<CloudStoreConfig | null> {
  if (!supabase || !navigator.onLine) return null;
  const { data, error } = await supabase
    .from('store_config')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !data) return null;
  return {
    storeSettings: data.store_settings as StoreSettings,
    ownerPassHash: data.owner_pass_hash as string,
    cashDrawer: data.cash_drawer as CashDrawer
  };
}

export async function syncStoreConfigToCloud(
  userId: string,
  config: {
    storeSettings: StoreSettings;
    ownerPassHash: string;
    cashDrawer: CashDrawer;
  }
) {
  if (!supabase || !navigator.onLine) return;
  await supabase.from('store_config').upsert(
    {
      user_id: userId,
      store_settings: config.storeSettings,
      owner_pass_hash: config.ownerPassHash,
      cash_drawer: config.cashDrawer,
      updated_at: new Date().toISOString()
    },
    { onConflict: 'user_id' }
  );
}

export async function syncProductToCloud(userId: string, product: Product) {
  if (!supabase || !navigator.onLine) return;
  await supabase.from('products').upsert(
    {
      user_id: userId,
      id: product.id,
      barcode: product.barcode,
      name: product.name,
      category: product.category,
      cost_price: product.costPrice,
      sell_price: product.sellPrice,
      stock: product.stock,
      updated_at: new Date().toISOString()
    },
    { onConflict: 'user_id,id' }
  );
}

export async function adjustProductStockInCloud(
  userId: string,
  productId: string,
  delta: number
): Promise<number | null> {
  const localProduct = await db.products.get(productId);
  let nextStock = localProduct ? Math.max(0, localProduct.stock + delta) : null;

  if (supabase && navigator.onLine) {
    const { data: cloudRow } = await supabase
      .from('products')
      .select('stock')
      .eq('user_id', userId)
      .eq('id', productId)
      .maybeSingle();

    const baseStock =
      typeof cloudRow?.stock === 'number'
        ? cloudRow.stock
        : (localProduct?.stock ?? 0);

    nextStock = Math.max(0, baseStock + delta);

    await supabase
      .from('products')
      .update({
        stock: nextStock,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId)
      .eq('id', productId);
  }

  if (localProduct && nextStock !== null) {
    await db.products.update(productId, { stock: nextStock });
  }

  return nextStock;
}

export async function deleteProductFromCloud(userId: string, productId: string) {
  if (!supabase || !navigator.onLine) return;
  await supabase.from('products').delete().eq('user_id', userId).eq('id', productId);
}

export async function syncPendingTransactions(userId: string) {
  if (!supabase || !navigator.onLine) return;

  const unsynced = await db.transactions.filter((t) => !t.synced).toArray();
  if (unsynced.length === 0) return;

  for (const trx of unsynced) {
    const { error } = await supabase.from('transactions').upsert(
      {
        user_id: userId,
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
      },
      { onConflict: 'user_id,id' }
    );

    if (!error) {
      await db.transactions.update(trx.id, { synced: true });
    }
  }
}