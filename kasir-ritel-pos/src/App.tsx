import React, { useState, useEffect, useCallback } from 'react';
import { db, seedInitialProducts } from './db/localDb';
import { supabase, isSupabaseConfigured, syncPendingTransactions } from './db/supabaseClient';
import { AuthRoleProvider, useAuthRole } from './context/AuthRoleContext';
import { PosPage } from './pages/PosPage';
import { ReportsPage } from './pages/ReportsPage';
import { ProductsPage } from './pages/ProductsPage';
import { SettingsPage } from './pages/SettingsPage';
import type { Product, Transaction, CashDrawer, StoreSettings } from './types/pos';
import './App.css';

const defaultSettings: StoreSettings = {
  storeName: 'Gilang Satrio Shop',
  storeAddress: 'Jl. Raya Toko No. 12',
  storePhone: '0812-3456-7890',
  bankAccount: 'BCA 1234567890 a.n. Gilang Satrio Shop',
  qrisImageDataUrl: '',
  receiptFooter: 'Terima Kasih\nBarang yang sudah dibeli\ntidak dapat ditukar'
};

const MainApp: React.FC = () => {
  const { isOwnerMode, loginOwner, logoutOwner } = useAuthRole();
  const [activeTab, setActiveTab] = useState<'pos' | 'reports' | 'products' | 'settings'>('pos');
  const [products, setProducts] = useState<Product[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  const [storeSettings, setStoreSettings] = useState<StoreSettings>(() => {
    const saved = localStorage.getItem('kasir_settings');
    return saved ? { ...defaultSettings, ...JSON.parse(saved) } : defaultSettings;
  });

  const [cashDrawer, setCashDrawer] = useState<CashDrawer>(() => {
    const saved = localStorage.getItem('kasir_drawer');
    return saved ? JSON.parse(saved) : { openingCash: 0, expenses: [] };
  });

  const [showLoginModal, setShowLoginModal] = useState(false);
  const [passInput, setPassInput] = useState('');

  useEffect(() => {
    document.title = `${storeSettings.storeName} - Kasir POS`;
  }, [storeSettings.storeName]);

  const loadAllData = useCallback(async () => {
    await seedInitialProducts();

    if (supabase && navigator.onLine) {
      await syncPendingTransactions();
      const { data: cloudProds } = await supabase.from('products').select('*');
      if (cloudProds && cloudProds.length > 0) {
        const mapped: Product[] = cloudProds.map((cp) => ({
          id: cp.id,
          barcode: cp.barcode,
          name: cp.name,
          category: cp.category,
          costPrice: Number(cp.cost_price),
          sellPrice: Number(cp.sell_price),
          stock: Number(cp.stock)
        }));
        await db.products.bulkPut(mapped);
      }

      const { data: cloudTrx } = await supabase.from('transactions').select('*').order('timestamp', { ascending: false });
      if (cloudTrx && cloudTrx.length > 0) {
        const mappedTrx: Transaction[] = cloudTrx.map((ct) => ({
          id: ct.id,
          timestamp: ct.timestamp,
          items: ct.items,
          subtotal: Number(ct.subtotal),
          discountAmount: Number(ct.discount_amount),
          totalRevenue: Number(ct.total_revenue),
          totalProfit: Number(ct.total_profit),
          paymentMethod: ct.payment_method,
          cashAmount: Number(ct.cash_amount),
          nonCashAmount: Number(ct.non_cash_amount),
          cashReceived: Number(ct.cash_received),
          change: Number(ct.change),
          refCode: ct.ref_code,
          isVoided: ct.is_voided,
          synced: true
        }));
        await db.transactions.bulkPut(mappedTrx);
      }
    }

    const localProds = await db.products.toArray();
    const localTrx = await db.transactions.orderBy('timestamp').reverse().toArray();
    setProducts(localProds);
    setTransactions(localTrx);
  }, []);

  useEffect(() => {
    loadAllData();
    const handleOnline = () => {
      setIsOnline(true);
      loadAllData();
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [loadAllData]);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await loginOwner(passInput);
    if (ok) {
      setShowLoginModal(false);
      setPassInput('');
    } else {
      alert('Kata sandi Owner salah!');
    }
  };

  return (
    <div>
      <div className="navbar">
        <div className="brand-area">
          <h1>{storeSettings.storeName}</h1>
          <span className={`role-badge ${isOwnerMode ? 'role-owner' : 'role-kasir'}`}>
            {isOwnerMode ? 'Mode Owner' : 'Mode Kasir'}
          </span>
          <span className={`sync-badge ${isOnline && isSupabaseConfigured ? 'sync-online' : 'sync-offline'}`}>
            {isOnline && isSupabaseConfigured ? 'Cloud Sync Aktif' : 'Mode Offline'}
          </span>
        </div>

        <div className="nav-right">
          <div className="nav-tabs">
            <button className={`nav-btn ${activeTab === 'pos' ? 'active' : ''}`} onClick={() => setActiveTab('pos')}>
              1. Kasir POS
            </button>
            <button className={`nav-btn ${activeTab === 'reports' ? 'active' : ''}`} onClick={() => setActiveTab('reports')}>
              2. Riwayat, Kas & Analitik
            </button>
            {isOwnerMode && (
              <>
                <button className={`nav-btn ${activeTab === 'products' ? 'active' : ''}`} onClick={() => setActiveTab('products')}>
                  3. Kelola Produk
                </button>
                <button className={`nav-btn ${activeTab === 'settings' ? 'active' : ''}`} onClick={() => setActiveTab('settings')}>
                  4. Pengaturan & QRIS
                </button>
              </>
            )}
          </div>

          {!isOwnerMode ? (
            <button className="btn-auth-owner" onClick={() => setShowLoginModal(true)}>Login Owner</button>
          ) : (
            <button
              className="btn-auth-logout"
              onClick={() => {
                logoutOwner(false);
                setActiveTab('pos');
              }}
            >
              Keluar Owner
            </button>
          )}
        </div>
      </div>

      <div className="main-wrapper">
        {activeTab === 'pos' && (
          <PosPage products={products} storeSettings={storeSettings} onDataChanged={loadAllData} />
        )}
        {activeTab === 'reports' && (
          <ReportsPage
            transactions={transactions}
            cashDrawer={cashDrawer}
            storeSettings={storeSettings}
            onUpdateDrawer={(d) => {
              setCashDrawer(d);
              localStorage.setItem('kasir_drawer', JSON.stringify(d));
            }}
            onDataChanged={loadAllData}
          />
        )}
        {activeTab === 'products' && isOwnerMode && (
          <ProductsPage products={products} storeSettings={storeSettings} onDataChanged={loadAllData} />
        )}
        {activeTab === 'settings' && isOwnerMode && (
          <SettingsPage
            settings={storeSettings}
            products={products}
            transactions={transactions}
            cashDrawer={cashDrawer}
            onSaveSettings={(s) => {
              setStoreSettings(s);
              localStorage.setItem('kasir_settings', JSON.stringify(s));
            }}
            onRestoreAll={async (restored) => {
              if (restored.storeSettings) {
                const merged = { ...defaultSettings, ...restored.storeSettings };
                setStoreSettings(merged);
                localStorage.setItem('kasir_settings', JSON.stringify(merged));
              }
              if (restored.cashDrawer) {
                setCashDrawer(restored.cashDrawer);
                localStorage.setItem('kasir_drawer', JSON.stringify(restored.cashDrawer));
              }
              await loadAllData();
            }}
          />
        )}
      </div>

      {showLoginModal && (
        <div className="modal-overlay">
          <div className="modal-box" style={{ maxWidth: 360 }}>
            <h3 style={{ marginTop: 0, fontSize: '1.1rem' }}>Masuk ke Mode Owner</h3>
            <p style={{ fontSize: '0.85rem', color: '#6b7280', marginTop: 0 }}>
              Mode Owner otomatis terkunci kembali jika tidak ada aktivitas selama 3 menit.
            </p>
            <form onSubmit={handleLoginSubmit}>
              <label>Kata Sandi Owner</label>
              <input
                type="password"
                placeholder="Default: admin123"
                value={passInput}
                onChange={(e) => setPassInput(e.target.value)}
                required
                autoFocus
              />
              <div className="modal-actions" style={{ marginTop: 10 }}>
                <button type="submit" className="btn-print" style={{ background: '#d97706' }}>Masuk Owner</button>
                <button type="button" className="btn-close" onClick={() => setShowLoginModal(false)}>Batal</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export function App() {
  return (
    <AuthRoleProvider>
      <MainApp />
    </AuthRoleProvider>
  );
}

export default App;