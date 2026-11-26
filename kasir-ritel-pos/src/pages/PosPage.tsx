import React, { useState, useEffect, useRef } from 'react';
import { db } from '../db/localDb';
import { adjustProductStockInCloud, syncPendingTransactions } from '../db/supabaseClient';
import { formatRupiah } from '../utils/helpers';
import type { Product, CartItem, Transaction, PaymentMethod, StoreSettings } from '../types/pos';

interface HeldCart {
  id: number;
  label: string;
  time: string;
  items: CartItem[];
}

interface PosPageProps {
  userId: string;
  products: Product[];
  storeSettings: StoreSettings;
  onDataChanged: () => void;
}

export const PosPage: React.FC<PosPageProps> = ({ userId, products, storeSettings, onDataChanged }) => {
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('Semua');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [discountType, setDiscountType] = useState<'NOMINAL' | 'PERCENT'>('NOMINAL');
  const [discountValue, setDiscountValue] = useState<number>(0);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('TUNAI');
  const [cashReceived, setCashReceived] = useState<number>(0);
  const [splitCash, setSplitCash] = useState<number>(0);

  const [heldCarts, setHeldCarts] = useState<HeldCart[]>(() => {
    const saved = localStorage.getItem('kasir_held_carts');
    return saved ? JSON.parse(saved) : [];
  });
  const [showHeldModal, setShowHeldModal] = useState(false);

  const [pendingOrder, setPendingOrder] = useState<{
    subtotal: number;
    discountAmount: number;
    grandTotal: number;
    method: PaymentMethod;
    cashPart: number;
    nonCashPart: number;
  } | null>(null);
  const [refCodeInput, setRefCodeInput] = useState('');
  const [receiptTrx, setReceiptTrx] = useState<Transaction | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const checkoutBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    localStorage.setItem('kasir_held_carts', JSON.stringify(heldCarts));
  }, [heldCarts]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      } else if (e.key === 'F8') {
        e.preventDefault();
        checkoutBtnRef.current?.click();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const categories = ['Semua', ...Array.from(new Set(products.map((p) => p.category)))];
  const filteredProducts = products.filter((p) => {
    const matchCat = activeCategory === 'Semua' || p.category === activeCategory;
    const kw = search.toLowerCase();
    const matchSearch = p.name.toLowerCase().includes(kw) || p.barcode.includes(kw);
    return matchCat && matchSearch;
  });

  const addToCart = (product: Product) => {
    if (product.stock <= 0) return;
    setCart((prev) => {
      const existing = prev.find((item) => item.id === product.id);
      if (existing) {
        if (existing.qty + 1 > product.stock) {
          alert(`Stok "${product.name}" hanya tersisa ${product.stock}!`);
          return prev;
        }
        return prev.map((item) => (item.id === product.id ? { ...item, qty: item.qty + 1 } : item));
      }
      return [...prev, { id: product.id, name: product.name, costPrice: product.costPrice, sellPrice: product.sellPrice, qty: 1 }];
    });
  };

  const updateQty = (productId: string, delta: number) => {
    const master = products.find((p) => p.id === productId);
    setCart((prev) =>
      prev
        .map((item) => {
          if (item.id !== productId) return item;
          const nextQty = item.qty + delta;
          if (master && nextQty > master.stock) {
            alert(`Maksimal stok tersedia: ${master.stock}`);
            return item;
          }
          return { ...item, qty: nextQty };
        })
        .filter((item) => item.qty > 0)
    );
  };

  const handleBarcodeEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && search.trim() !== '') {
      const exact = products.find((p) => p.barcode === search.trim());
      if (exact) {
        addToCart(exact);
        setSearch('');
      }
    }
  };

  const handleHoldCart = () => {
    if (cart.length === 0) return alert('Keranjang kosong, tidak ada antrean untuk ditahan.');
    const note = prompt('Masukkan nama/catatan singkat pembeli (opsional):', `Pembeli #${heldCarts.length + 1}`);
    if (note === null) return;

    setHeldCarts((prev) => [
      ...prev,
      {
        id: Date.now(),
        label: note.trim() || `Antrean #${prev.length + 1}`,
        time: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
        items: JSON.parse(JSON.stringify(cart))
      }
    ]);
    setCart([]);
    setDiscountValue(0);
  };

  const handleRecallCart = (idx: number) => {
    if (cart.length > 0 && !confirm('Keranjang saat ini tidak kosong. Timpa dengan antrean yang dipanggil?')) return;
    setCart(heldCarts[idx].items);
    setHeldCarts((prev) => prev.filter((_, i) => i !== idx));
    setShowHeldModal(false);
  };

  const subtotal = cart.reduce((sum, item) => sum + item.sellPrice * item.qty, 0);
  const discountAmount =
    discountType === 'PERCENT'
      ? Math.round((subtotal * Math.min(100, Math.max(0, discountValue))) / 100)
      : Math.min(subtotal, Math.max(0, discountValue));
  const grandTotal = Math.max(0, subtotal - discountAmount);
  const change = cashReceived - grandTotal;
  const splitNonCash = Math.max(0, grandTotal - splitCash);

  const handleCheckoutClick = () => {
    if (cart.length === 0) return alert('Keranjang masih kosong!');

    if (paymentMethod === 'TUNAI') {
      if (cashReceived < grandTotal) return alert('Uang tunai kurang dari total belanja!');
      finalizeTransaction({
        subtotal,
        discountAmount,
        grandTotal,
        method: 'TUNAI',
        cashPart: grandTotal,
        nonCashPart: 0,
        cashReceived,
        change: cashReceived - grandTotal,
        refCode: ''
      });
      return;
    }

    let cashPart = 0;
    let nonCashPart = grandTotal;
    if (paymentMethod === 'CAMPURAN') {
      if (splitCash <= 0 || splitCash >= grandTotal) {
        return alert('Nominal tunai campuran harus lebih dari Rp 0 dan kurang dari Total Bayar!');
      }
      cashPart = splitCash;
      nonCashPart = grandTotal - splitCash;
    }

    setRefCodeInput('');
    setPendingOrder({ subtotal, discountAmount, grandTotal, method: paymentMethod, cashPart, nonCashPart });
  };

  const handleVerifyNonCashSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingOrder) return;
    if (refCodeInput.trim().length < 3) {
      return alert('Masukkan minimal 3 karakter Nomor Referensi / RRN mutasi masuk!');
    }

    const order = pendingOrder;
    setPendingOrder(null);
    finalizeTransaction({
      subtotal: order.subtotal,
      discountAmount: order.discountAmount,
      grandTotal: order.grandTotal,
      method: order.method,
      cashPart: order.cashPart,
      nonCashPart: order.nonCashPart,
      cashReceived: order.cashPart,
      change: 0,
      refCode: refCodeInput.trim().toUpperCase()
    });
  };

  const finalizeTransaction = async (data: {
    subtotal: number;
    discountAmount: number;
    grandTotal: number;
    method: PaymentMethod;
    cashPart: number;
    nonCashPart: number;
    cashReceived: number;
    change: number;
    refCode: string;
  }) => {
    for (const item of cart) {
      const master = await db.products.get(item.id);
      if (master) {
        const optimisticStock = Math.max(0, master.stock - item.qty);
        await db.products.put({ ...master, stock: optimisticStock });
        const serverStock = await adjustProductStockInCloud(userId, item.id, -item.qty);
        if (serverStock !== null) {
          await db.products.update(item.id, { stock: serverStock });
        }
      }
    }

    const totalCost = cart.reduce((sum, item) => sum + item.costPrice * item.qty, 0);
    const newTrx: Transaction = {
      id: 'TRX-' + Date.now().toString().slice(-6),
      timestamp: new Date().toISOString(),
      items: [...cart],
      subtotal: data.subtotal,
      discountAmount: data.discountAmount,
      totalRevenue: data.grandTotal,
      totalProfit: data.grandTotal - totalCost,
      paymentMethod: data.method,
      cashAmount: data.cashPart,
      nonCashAmount: data.nonCashPart,
      cashReceived: data.cashReceived,
      change: data.change,
      refCode: data.refCode,
      isVoided: false,
      synced: false
    };

    await db.transactions.add(newTrx);
    await syncPendingTransactions(userId);

    setReceiptTrx(newTrx);
    setCart([]);
    setCashReceived(0);
    setSplitCash(0);
    setDiscountValue(0);
    onDataChanged();
  };

  const printReceipt = () => {
    document.body.classList.remove('printing-receipt', 'printing-label');
    document.body.classList.add('printing-receipt');
    window.print();
  };

  return (
    <div className="pos-grid">
      <div className="panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e5e7eb', paddingBottom: 10, marginBottom: 12 }}>
          <h2 style={{ border: 'none', margin: 0, padding: 0 }}>Katalog Barang</h2>
          <small style={{ color: '#6b7280' }}>Pintasan: <strong>[F2]</strong> Scan • <strong>[F8]</strong> Bayar</small>
        </div>
        <input
          ref={searchInputRef}
          type="text"
          className="search-box"
          placeholder="Scan barcode atau ketik nama barang..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={handleBarcodeEnter}
          autoFocus
        />
        <div className="category-bar">
          {categories.map((cat) => {
            const count = cat === 'Semua' ? products.length : products.filter((p) => p.category === cat).length;
            return (
              <button
                key={cat}
                className={`cat-btn ${activeCategory === cat ? 'active' : ''}`}
                onClick={() => setActiveCategory(cat)}
              >
                {cat} ({count})
              </button>
            );
          })}
        </div>
        <div className="product-grid">
          {filteredProducts.map((p) => {
            const isOut = p.stock <= 0;
            const isLow = p.stock > 0 && p.stock <= 5;
            return (
              <div
                key={p.id}
                className={`product-card ${isOut ? 'out-of-stock' : ''}`}
                onClick={() => !isOut && addToCart(p)}
              >
                <div className="card-top">
                  <span className="barcode-tag">#{p.barcode}</span>
                  <span className="cat-badge">{p.category}</span>
                </div>
                <div><strong>{p.name}</strong></div>
                <div className="price">{formatRupiah(p.sellPrice)}</div>
                <div className={`stock ${isOut ? 'empty' : isLow ? 'low' : ''}`}>
                  {isOut ? 'Stok Habis' : isLow ? `Stok Menipis: ${p.stock}` : `Stok: ${p.stock}`}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="panel">
        <div className="cart-header">
          <h2 style={{ border: 'none', margin: 0, padding: 0 }}>Keranjang Transaksi</h2>
          <div className="hold-actions">
            <button type="button" className="btn-hold" onClick={handleHoldCart}>Tahan Antrean</button>
            <button type="button" className="btn-recall" onClick={() => setShowHeldModal(true)}>
              Antrean ({heldCarts.length})
            </button>
          </div>
        </div>

        <div className="cart-list">
          {cart.length === 0 ? (
            <p style={{ color: '#6b7280', textAlign: 'center' }}>Scan atau klik barang untuk mulai transaksi</p>
          ) : (
            cart.map((item) => (
              <div key={item.id} className="cart-item">
                <div>
                  <strong>{item.name}</strong><br />
                  <small>{formatRupiah(item.sellPrice)} x {item.qty} = <strong>{formatRupiah(item.sellPrice * item.qty)}</strong></small>
                </div>
                <div className="qty-controls">
                  <button onClick={() => updateQty(item.id, -1)}>-</button>
                  <span style={{ margin: '0 8px', fontWeight: 'bold' }}>{item.qty}</span>
                  <button onClick={() => updateQty(item.id, 1)}>+</button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="summary">
          <div className="summary-row">
            <span>Subtotal:</span>
            <span>{formatRupiah(subtotal)}</span>
          </div>
          <div className="discount-box">
            <select value={discountType} onChange={(e) => setDiscountType(e.target.value as 'NOMINAL' | 'PERCENT')}>
              <option value="NOMINAL">Diskon (Rp)</option>
              <option value="PERCENT">Diskon (%)</option>
            </select>
            <input
              type="number"
              min={0}
              value={discountValue || ''}
              placeholder="0"
              onChange={(e) => setDiscountValue(Number(e.target.value) || 0)}
            />
          </div>
          <div className="summary-row total-row">
            <span>Total Bayar</span>
            <span>{formatRupiah(grandTotal)}</span>
          </div>

          <label><strong>Metode Pembayaran:</strong></label>
          <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}>
            <option value="TUNAI">Tunai (Cash)</option>
            <option value="QRIS">QRIS (Wajib Verifikasi Masuk)</option>
            <option value="TRANSFER">Transfer Bank (Wajib Verifikasi Masuk)</option>
            <option value="CAMPURAN">Campuran (Tunai + QRIS/Transfer)</option>
          </select>

          {paymentMethod === 'TUNAI' && (
            <div>
              <label><strong>Uang Diterima (Rp):</strong></label>
              <input
                type="number"
                min={0}
                value={cashReceived || ''}
                placeholder="0"
                onChange={(e) => setCashReceived(Number(e.target.value) || 0)}
              />
              <div className="quick-cash">
                <button type="button" onClick={() => setCashReceived(grandTotal)}>Uang Pas</button>
                <button type="button" onClick={() => setCashReceived((prev) => prev + 50000)}>+50.000</button>
                <button type="button" onClick={() => setCashReceived((prev) => prev + 100000)}>+100.000</button>
              </div>
              <div className="summary-row">
                <span>Kembalian:</span>
                <strong style={{ color: change >= 0 ? '#2563eb' : '#dc2626' }}>
                  {change >= 0 ? formatRupiah(change) : 'Uang kurang'}
                </strong>
              </div>
            </div>
          )}

          {paymentMethod === 'CAMPURAN' && (
            <div style={{ background: '#fff', padding: 10, borderRadius: 6, border: '1px solid #cbd5e1', marginBottom: 10 }}>
              <label><strong>Nominal Tunai Diterima (Rp):</strong></label>
              <input
                type="number"
                min={1}
                placeholder="Masukkan porsi uang tunai..."
                value={splitCash || ''}
                onChange={(e) => setSplitCash(Number(e.target.value) || 0)}
              />
              <div className="summary-row" style={{ marginBottom: 0 }}>
                <span>Sisa Wajib Masuk QRIS / Transfer:</span>
                <strong style={{ color: '#d97706' }}>{formatRupiah(splitNonCash)}</strong>
              </div>
            </div>
          )}

          <button ref={checkoutBtnRef} className="btn-pay" onClick={handleCheckoutClick}>
            Proses Pembayaran [F8]
          </button>
        </div>
      </div>

      {showHeldModal && (
        <div className="modal-overlay">
          <div className="modal-box">
            <h3 style={{ marginTop: 0, fontSize: '1.05rem' }}>Daftar Antrean Ditahan</h3>
            {heldCarts.length === 0 ? (
              <p style={{ color: '#6b7280', textAlign: 'center' }}>Tidak ada antrean yang ditahan.</p>
            ) : (
              heldCarts.map((h, idx) => {
                const total = h.items.reduce((s, i) => s + i.sellPrice * i.qty, 0);
                return (
                  <div key={h.id} className="held-item">
                    <div>
                      <strong>{h.label}</strong> <small style={{ color: '#6b7280' }}>({h.time})</small><br />
                      <small>{h.items.length} jenis barang • <strong>{formatRupiah(total)}</strong></small>
                    </div>
                    <div style={{ display: 'flex', gap: 5 }}>
                      <button className="btn-sm btn-edit" onClick={() => handleRecallCart(idx)}>Panggil</button>
                      <button className="btn-sm btn-del" onClick={() => setHeldCarts((prev) => prev.filter((_, i) => i !== idx))}>Hapus</button>
                    </div>
                  </div>
                );
              })
            )}
            <button className="btn-close" style={{ width: '100%', marginTop: 10 }} onClick={() => setShowHeldModal(false)}>Tutup</button>
          </div>
        </div>
      )}

      {pendingOrder && (
        <div className="modal-overlay">
          <div className="modal-box" style={{ maxWidth: 420 }}>
            <h3 style={{ marginTop: 0, fontSize: '1.1rem', color: '#1e293b' }}>
              {pendingOrder.method === 'TRANSFER'
                ? 'Verifikasi Transfer Bank Masuk'
                : pendingOrder.method === 'CAMPURAN'
                ? 'Verifikasi Sisa Bayar QRIS / Transfer'
                : 'Verifikasi Pembayaran QRIS Masuk'}
            </h3>
            <div className="verify-amount-banner">
              <div style={{ fontSize: '0.82rem', color: '#475569' }}>Nominal Wajib Masuk ke Rekening / QRIS:</div>
              <div className="big-rp">{formatRupiah(pendingOrder.nonCashPart)}</div>
              {pendingOrder.method === 'CAMPURAN' && (
                <div style={{ fontSize: '0.8rem', color: '#059669', marginTop: 4, fontWeight: 600 }}>
                  Total Belanja {formatRupiah(pendingOrder.grandTotal)} (Tunai: {formatRupiah(pendingOrder.cashPart)} + Non-Tunai: {formatRupiah(pendingOrder.nonCashPart)})
                </div>
              )}
            </div>

            {(pendingOrder.method === 'QRIS' || pendingOrder.method === 'CAMPURAN') && storeSettings.qrisImageDataUrl && (
              <img src={storeSettings.qrisImageDataUrl} alt="QRIS Toko" className="qris-modal-img" />
            )}
            {storeSettings.bankAccount && (
              <div className="bank-info-box">
                <strong>Rekening Transfer Toko:</strong><br />{storeSettings.bankAccount}
              </div>
            )}

            <div className="verify-warning">
              <strong>PROSEDUR KASIR:</strong> Pastikan notifikasi uang masuk sudah muncul di HP Merchant / M-Banking toko dengan nominal persis di atas sebelum menekan tombol konfirmasi!
            </div>

            <form onSubmit={handleVerifyNonCashSubmit}>
              <label><strong>Masukkan 4–6 Digit Nomor Referensi / RRN Mutasi:</strong></label>
              <input
                type="text"
                placeholder="Contoh: 849201 atau RRN mutasi..."
                value={refCodeInput}
                onChange={(e) => setRefCodeInput(e.target.value)}
                required
                autoFocus
              />
              <div className="modal-actions" style={{ marginTop: 10 }}>
                <button type="submit" className="btn-print" style={{ background: '#16a34a' }}>Konfirmasi Uang Masuk</button>
                <button type="button" className="btn-close" onClick={() => setPendingOrder(null)}>Batal / Belum Masuk</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {receiptTrx && (
        <div className="modal-overlay">
          <div className="modal-box" style={{ maxWidth: 340 }}>
            <h3 style={{ marginTop: 0, textAlign: 'center', fontSize: '1rem' }}>Preview Struk Belanja</h3>
            <div id="receiptPrintArea" className="receipt-paper">
              <div className="rec-center">
                <strong>{storeSettings.storeName}</strong><br />
                {storeSettings.storeAddress}<br />
                Telp: {storeSettings.storePhone}
              </div>
              <div className="rec-divider" />
              <div>No: {receiptTrx.id}</div>
              <div>Tgl: {new Date(receiptTrx.timestamp).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })}</div>
              <div className="rec-divider" />
              {receiptTrx.items.map((item) => (
                <div key={item.id}>
                  <div>{item.name}</div>
                  <div className="rec-row">
                    <span>{item.qty} x {item.sellPrice.toLocaleString('id-ID')}</span>
                    <span>{(item.qty * item.sellPrice).toLocaleString('id-ID')}</span>
                  </div>
                </div>
              ))}
              <div className="rec-divider" />
              {receiptTrx.discountAmount > 0 && (
                <>
                  <div className="rec-row"><span>Subtotal</span><span>{formatRupiah(receiptTrx.subtotal)}</span></div>
                  <div className="rec-row"><span>Diskon</span><span>-{formatRupiah(receiptTrx.discountAmount)}</span></div>
                </>
              )}
              <div className="rec-row"><strong>TOTAL</strong><strong>{formatRupiah(receiptTrx.totalRevenue)}</strong></div>
              {receiptTrx.paymentMethod === 'TUNAI' ? (
                <>
                  <div className="rec-row"><span>Tunai</span><span>{formatRupiah(receiptTrx.cashReceived)}</span></div>
                  <div className="rec-row"><span>Kembali</span><span>{formatRupiah(receiptTrx.change)}</span></div>
                </>
              ) : (
                <div>Metode: {receiptTrx.paymentMethod} {receiptTrx.refCode ? `(Ref: ${receiptTrx.refCode})` : ''}</div>
              )}
              <div className="rec-divider" />
              <div className="rec-center">{storeSettings.receiptFooter}</div>
            </div>
            <div className="modal-actions">
              <button className="btn-print" onClick={printReceipt}>Cetak Struk</button>
              <button className="btn-close" onClick={() => setReceiptTrx(null)}>Tutup</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};