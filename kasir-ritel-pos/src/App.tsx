import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { Session } from '@supabase/supabase-js';
import { db, seedInitialProducts } from './db/localDb';
import {
  supabase,
  isSupabaseConfigured,
  syncPendingTransactions,
  fetchStoreConfigFromCloud,
  syncStoreConfigToCloud,
  syncProductToCloud
} from './db/supabaseClient';
import { AuthRoleProvider, useAuthRole, DEFAULT_PASS_HASH } from './context/AuthRoleContext';
import { AuthGate } from './components/AuthGate';
import { PosPage } from './pages/PosPage';
import { ReportsPage } from './pages/ReportsPage';
import { ProductsPage } from './pages/ProductsPage';
import { SettingsPage } from './pages/SettingsPage';
import type { Product, Transaction, CashDrawer, StoreSettings } from './types/pos';
import './App.css';

const createDefaultSettings = (storeName = 'Toko Ritel Mandiri'): StoreSettings => ({
  storeName,
  storeAddress: 'Jl. Raya Toko No. 12',
  storePhone: '0812-3456-7890',
  bankAccount: '',
  qrisImageDataUrl: '',
  receiptFooter: 'Terima Kasih\nBarang yang sudah dibeli\ntidak dapat ditukar'
});

const StoreWorkspace: React.FC<{ session: Session }> = ({ session }) => {
  const userId = session.user.id;
  const registeredStoreName = (session.user.user_metadata?.store_name as string) || 'Toko Ritel Mandiri';

  const { isOwnerMode, passwordHash, loginOwner, logoutOwner, applyCloudPasswordHash } = useAuthRole();
  const [activeTab, setActiveTab] = useState<'pos' | 'reports' | 'products' | 'settings'>('pos');
  const [products, setProducts] = useState<Product[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  const settingsKey = `kasir_settings_${userId}`;
  const drawerKey = `kasir_drawer_${userId}`;

  const [storeSettings, setStoreSettings] = useState<StoreSettings>(() => {
    const saved = localStorage.getItem(settingsKey);
    return saved ? { ...createDefaultSettings(registeredStoreName), ...JSON.parse(saved) } : createDefaultSettings(registeredStoreName);
  });

  const [cashDrawer, setCashDrawer] = useState<CashDrawer>(() => {
    const saved = localStorage.getItem(drawerKey);
    return saved ? JSON.parse(saved) : { openingCash: 0, expenses: [] };
  });

  const [showLoginModal, setShowLoginModal] = useState(false);
  const [passInput, setPassInput] = useState('');
  const [verifyingOwner, setVerifyingOwner] = useState(false);

  const isInitialCloudSyncDone = useRef(false);
  const latestConfigRef = useRef({ storeSettings, ownerPassHash: passwordHash, cashDrawer });

  useEffect(() => {
    latestConfigRef.current = { storeSettings, ownerPassHash: passwordHash, cashDrawer };
  }, [storeSettings, passwordHash, cashDrawer]);

  useEffect(() => {
    document.title = `${storeSettings.storeName} - Kasir POS`;
  }, [storeSettings.storeName]);

  useEffect(() => {
    if (!isInitialCloudSyncDone.current) return;
    syncStoreConfigToCloud(userId, {
      storeSettings,
      ownerPassHash: passwordHash,
      cashDrawer
    });
  }, [userId, passwordHash, storeSettings, cashDrawer]);

  const loadAllData = useCallback(async () => {
    if (supabase && navigator.onLine) {
      await syncPendingTransactions(userId);

      // 1. Sinkronkan Pengaturan Toko, Password Owner & Kas Laci dari akun cloud
      const cloudConfig = await fetchStoreConfigFromCloud(userId);
      if (cloudConfig) {
        if (cloudConfig.storeSettings) {
          const merged = { ...createDefaultSettings(registeredStoreName), ...cloudConfig.storeSettings };
          setStoreSettings(merged);
          localStorage.setItem(settingsKey, JSON.stringify(merged));
        }
        if (cloudConfig.ownerPassHash) {
          applyCloudPasswordHash(cloudConfig.ownerPassHash);
        }
        if (cloudConfig.cashDrawer) {
          setCashDrawer(cloudConfig.cashDrawer);
          localStorage.setItem(drawerKey, JSON.stringify(cloudConfig.cashDrawer));
        }
      } else {
        await syncStoreConfigToCloud(userId, latestConfigRef.current);
      }

      // 2. Sinkronkan Produk (terisolasi per user_id)
      const { data: cloudProds } = await supabase.from('products').select('*').eq('user_id', userId);
      if (cloudProds && cloudProds.length > 0) {
        await db.products.clear();
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
      } else if (cloudProds && cloudProds.length === 0) {
        await db.products.clear();
        await seedInitialProducts();
        const starterProducts = await db.products.toArray();
        for (const p of starterProducts) {
          await syncProductToCloud(userId, p);
        }
      }

      // 3. Sinkronkan Transaksi (terisolasi per user_id)
      const { data: cloudTrx } = await supabase
        .from('transactions')
        .select('*')
        .eq('user_id', userId)
        .order('timestamp', { ascending: false });

      if (cloudTrx) {
        await db.transactions.clear();
        if (cloudTrx.length > 0) {
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
    } else {
      await seedInitialProducts();
    }

    isInitialCloudSyncDone.current = true;
    const localProds = await db.products.toArray();
    const localTrx = await db.transactions.orderBy('timestamp').reverse().toArray();
    setProducts(localProds);
    setTransactions(localTrx);
  }, [userId, registeredStoreName, settingsKey, drawerKey, applyCloudPasswordHash]);

  useEffect(() => {
    loadAllData();
    const handleOnline = () => {
      setIsOnline(true);
      loadAllData();
    };
    const handleOffline = () => setIsOnline(false);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        loadAllData();
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [loadAllData]);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setVerifyingOwner(true);
    const ok = await loginOwner(passInput);
    setVerifyingOwner(false);
    if (ok) {
      setShowLoginModal(false);
      setPassInput('');
    } else {
      alert('Kata sandi Owner salah!');
    }
  };

  const handleAccountLogout = async () => {
    if (!confirm(`Keluar dari akun toko (${session.user.email})?`)) return;
    await db.products.clear();
    await db.transactions.clear();
    localStorage.removeItem(settingsKey);
    localStorage.removeItem(drawerKey);
    localStorage.removeItem('kasir_held_carts');
    await supabase?.auth.signOut();
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

          <button
            type="button"
            onClick={handleAccountLogout}
            title={`Akun: ${session.user.email}`}
            style={{ background: '#475569', color: '#f8fafc', border: 'none', padding: '8px 12px', borderRadius: 6, cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600 }}
          >
            Keluar Akun
          </button>
        </div>
      </div>

      <div className="main-wrapper">
        {activeTab === 'pos' && (
          <PosPage userId={userId} products={products} storeSettings={storeSettings} onDataChanged={loadAllData} />
        )}
        {activeTab === 'reports' && (
          <ReportsPage
            userId={userId}
            transactions={transactions}
            cashDrawer={cashDrawer}
            storeSettings={storeSettings}
            onUpdateDrawer={(d) => {
              setCashDrawer(d);
              localStorage.setItem(drawerKey, JSON.stringify(d));
            }}
            onDataChanged={loadAllData}
          />
        )}
        {activeTab === 'products' && isOwnerMode && (
          <ProductsPage userId={userId} products={products} storeSettings={storeSettings} onDataChanged={loadAllData} />
        )}
        {activeTab === 'settings' && isOwnerMode && (
          <SettingsPage
            userId={userId}
            settings={storeSettings}
            products={products}
            transactions={transactions}
            cashDrawer={cashDrawer}
            onSaveSettings={(s) => {
              setStoreSettings(s);
              localStorage.setItem(settingsKey, JSON.stringify(s));
            }}
            onRestoreAll={async (restored) => {
              if (restored.storeSettings) {
                const merged = { ...createDefaultSettings(registeredStoreName), ...restored.storeSettings };
                setStoreSettings(merged);
                localStorage.setItem(settingsKey, JSON.stringify(merged));
              }
              if (restored.cashDrawer) {
                setCashDrawer(restored.cashDrawer);
                localStorage.setItem(drawerKey, JSON.stringify(restored.cashDrawer));
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
                placeholder="Masukkan sandi Owner..."
                value={passInput}
                onChange={(e) => setPassInput(e.target.value)}
                required
                autoFocus
              />
              <div className="modal-actions" style={{ marginTop: 10 }}>
                <button type="submit" className="btn-print" style={{ background: '#d97706' }} disabled={verifyingOwner}>
                  {verifyingOwner ? 'Memverifikasi...' : 'Masuk Owner'}
                </button>
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
  const [session, setSession] = useState<Session | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    if (!supabase) {
      setCheckingSession(false);
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setCheckingSession(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  if (checkingSession) {
    return <div style={{ padding: 40, textAlign: 'center' }}>Memuat sesi akun toko...</div>;
  }

  if (!session) {
    return <AuthGate />;
  }

  const accountInitialPassHash =
    (session.user.user_metadata?.owner_pass_hash as string) || DEFAULT_PASS_HASH;

  return (
    <AuthRoleProvider userId={session.user.id} initialHash={accountInitialPassHash}>
      <StoreWorkspace session={session} />
    </AuthRoleProvider>
  );
}

export default App;