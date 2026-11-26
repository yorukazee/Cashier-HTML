export type PaymentMethod = 'TUNAI' | 'QRIS' | 'TRANSFER' | 'CAMPURAN';

export interface ActiveShift {
  cashierName: string;
  shiftName: string;
}

export interface Product {
  id: string;
  barcode: string;
  name: string;
  category: string;
  costPrice: number;
  sellPrice: number;
  wholesaleMinQty?: number;
  wholesalePrice?: number;
  stock: number;
  updatedAt?: string;
}

export interface CartItem {
  id: string;
  name: string;
  costPrice: number;
  sellPrice: number;
  wholesaleMinQty?: number;
  wholesalePrice?: number;
  appliedPrice?: number;
  isWholesale?: boolean;
  qty: number;
}

export interface Transaction {
  id: string;
  timestamp: string;
  cashierName?: string;
  shiftName?: string;
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
  cashierName?: string;
  shiftName?: string;
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