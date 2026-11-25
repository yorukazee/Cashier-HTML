import Dexie, { type Table } from 'dexie';
import type { Product, Transaction } from '../types/pos';

export class KasirDatabase extends Dexie {
  products!: Table<Product, string>;
  transactions!: Table<Transaction, string>;

  constructor() {
    super('KasirRitelDB');
    this.version(1).stores({
      products: 'id, barcode, name, category',
      transactions: 'id, timestamp, paymentMethod, isVoided, synced'
    });
  }
}

export const db = new KasirDatabase();

// Data awal otomatis jika database masih kosong
export async function seedInitialProducts() {
  const count = await db.products.count();
  if (count > 0) return;

  await db.products.bulkAdd([
    { id: 'BRG-01', barcode: '8991001', name: 'Indomie Goreng', category: 'Makanan', costPrice: 2800, sellPrice: 3500, stock: 24 },
    { id: 'BRG-02', barcode: '8991002', name: 'Chitato Sapi Panggang', category: 'Makanan', costPrice: 8500, sellPrice: 10500, stock: 12 },
    { id: 'BRG-03', barcode: '8991003', name: 'Aqua Botol 600ml', category: 'Minuman', costPrice: 2500, sellPrice: 4000, stock: 15 },
    { id: 'BRG-04', barcode: '8991004', name: 'Teh Botol Sosro 450ml', category: 'Minuman', costPrice: 4200, sellPrice: 6000, stock: 18 },
    { id: 'BRG-05', barcode: '8991005', name: 'Sabun Mandi Lifebuoy', category: 'Sabun', costPrice: 18000, sellPrice: 23000, stock: 8 },
    { id: 'BRG-06', barcode: '8991006', name: 'Detergen Rinso 770g', category: 'Sabun', costPrice: 19500, sellPrice: 24000, stock: 4 },
    { id: 'BRG-07', barcode: '8991007', name: 'Beras Ramos 5kg', category: 'Sembako', costPrice: 65000, sellPrice: 72000, stock: 3 },
    { id: 'BRG-08', barcode: '8991008', name: 'Minyak Goreng 1L', category: 'Sembako', costPrice: 14500, sellPrice: 17000, stock: 10 }
  ]);
}