export type PaymentMethod = 'TUNAI' | 'QRIS' | 'TRANSFER' | 'CAMPURAN';

export interface Product {
  id: string;
  barcode: string;
  name: string;
  category: string;
  costPrice: number;
  sellPrice: number;
  stock: number;
  updatedAt?: string;
}

export interface CartItem {
  id: string;
  name: string;
  costPrice: number;
  sellPrice: number;
  qty: number;
}

export interface Transaction {
  id: string;
  timestamp: string;
  items: CartItem[];
  subtotal: number;
  discountAmount: number;
  totalRevenue: number;
  totalProfit: number;
  paymentMethod: PaymentMethod;
  cashAmount: number;
  nonCashAmount: number;
  cashReceived: number;
  change: number;
  refCode: string;
  isVoided: boolean;
  synced?: boolean;
}

export interface DrawerExpense {
  id: number;
  time: string;
  note: string;
  amount: number;
}

export interface CashDrawer {
  openingCash: number;
  expenses: DrawerExpense[];
}

export interface StoreSettings {
  storeName: string;
  storeAddress: string;
  storePhone: string;
  bankAccount: string;
  qrisImageDataUrl: string;
  receiptFooter: string;
}