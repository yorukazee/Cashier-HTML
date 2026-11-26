import React, { useState } from 'react';
import { db } from '../db/localDb';
import { supabase, adjustProductStockInCloud } from '../db/supabaseClient';
import { useAuthRole } from '../context/AuthRoleContext';
import { formatRupiah } from '../utils/helpers';
import type { Transaction, CashDrawer, StoreSettings, ActiveShift } from '../types/pos';

interface ReportsPageProps {
  userId: string;
  transactions: Transaction[];
  cashDrawer: CashDrawer;
  storeSettings: StoreSettings;
  onUpdateDrawer: (drawer: CashDrawer) => void;
  onDataChanged: () => void;
}

function getCurrentShift(): ActiveShift {
  try {
    const saved = localStorage.getItem('kasir_active_shift');
    if (saved) {
      const parsed = JSON.parse(saved);
      return {
        cashierName: parsed.cashierName || 'Kasir 1',
        shiftName: parsed.shiftName || 'Shift Pagi'
      };
    }
  } catch {
    // ignore storage errors
  }
  return { cashierName: 'Kasir 1', shiftName: 'Shift Pagi' };
}

export const ReportsPage: React.FC<ReportsPageProps> = ({
  userId,
  transactions,
  cashDrawer,
  storeSettings,
  onUpdateDrawer,
  onDataChanged
}) => {
  const { isOwnerMode } = useAuthRole();
  const [dateFilter, setDateFilter] = useState<'ALL' | 'TODAY' | 'YESTERDAY'>('ALL');
  const [shiftFilter, setShiftFilter] = useState<string>('ALL');
  const [showExpenseList, setShowExpenseList] = useState(false);
  const [reprintTrx, setReprintTrx] = useState<Transaction | null>(null);

  const filteredTrx = transactions.filter((t) => {
    if (shiftFilter !== 'ALL' && (t.shiftName || 'Tanpa Shift') !== shiftFilter) {
      return false;
    }
    if (dateFilter === 'ALL') return true;
    const now = new Date();
    const dStr = new Date(t.timestamp).toDateString();
    if (dateFilter === 'TODAY') return dStr === now.toDateString();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    return dStr === yesterday.toDateString();
  });

  let totalRevenue = 0;
  let totalProfit = 0;
  let totalCash = 0;
  let totalNonCash = 0;
  const salesMap: Record<string, { name: string; qty: number; revenue: number }> = {};
  const shiftSummaryMap: Record<string, { shiftName: string; count: number; revenue: number; cash: number; nonCash: number }> = {};

  filteredTrx.forEach((t) => {
    if (!t.isVoided) {
      totalRevenue += t.totalRevenue;
      totalProfit += t.totalProfit;

      let trxCash = 0;
      let trxNonCash = 0;
      if (t.paymentMethod === 'TUNAI') {
        trxCash = t.totalRevenue;
      } else if (t.paymentMethod === 'CAMPURAN') {
        trxCash = t.cashAmount;
        trxNonCash = t.nonCashAmount;
      } else {
        trxNonCash = t.totalRevenue;
      }
      totalCash += trxCash;
      totalNonCash += trxNonCash;

      const sKey = t.shiftName || 'Tanpa Shift';
      if (!shiftSummaryMap[sKey]) {
        shiftSummaryMap[sKey] = { shiftName: sKey, count: 0, revenue: 0, cash: 0, nonCash: 0 };
      }
      shiftSummaryMap[sKey].count += 1;
      shiftSummaryMap[sKey].revenue += t.totalRevenue;
      shiftSummaryMap[sKey].cash += trxCash;
      shiftSummaryMap[sKey].nonCash += trxNonCash;

      t.items.forEach((item) => {
        const unitPrice = item.appliedPrice ?? item.sellPrice;
        if (!salesMap[item.name]) salesMap[item.name] = { name: item.name, qty: 0, revenue: 0 };
        salesMap[item.name].qty += item.qty;
        salesMap[item.name].revenue += unitPrice * item.qty;
      });
    }
  });

  // Grafik Omzet 7 Hari Terakhir (dari seluruh transaksi valid)
  const last7Days: { key: string; label: string; total: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    last7Days.push({
      key: d.toDateString(),
      label: d.toLocaleDateString('id-ID', { weekday: 'short', day: '2-digit', month: 'short' }),
      total: 0
    });
  }
  transactions.forEach((t) => {
    if (t.isVoided) return;
    const dKey = new Date(t.timestamp).toDateString();
    const found = last7Days.find((day) => day.key === dKey);
    if (found) found.total += t.totalRevenue;
  });
  const maxDailyRevenue = Math.max(1, ...last7Days.map((d) => d.total));

  const shiftSummaries = Object.values(shiftSummaryMap);
  const topProducts = Object.values(salesMap).sort((a, b) => b.qty - a.qty).slice(0, 5);
  const totalExpenses = cashDrawer.expenses.reduce((s, e) => s + e.amount, 0);
  const expectedDrawerCash = cashDrawer.openingCash + totalCash - totalExpenses;

  const handleSetOpeningCash = () => {
    const val = prompt('Masukkan jumlah Modal Awal Uang Tunai di Laci Kasir (Rp):', String(cashDrawer.openingCash));
    if (val === null) return;
    const num = Number(val);
    if (!isNaN(num) && num >= 0) {
      onUpdateDrawer({ ...cashDrawer, openingCash: num });
    }
  };

  const handleAddExpense = () => {
    const note = prompt('Keterangan pengeluaran kas kecil (misal: Beli plastik kresek / galon):');
    if (!note) return;
    const amt = Number(prompt('Nominal keluar (Rp):', '15000'));
    if (!isNaN(amt) && amt > 0) {
      const shift = getCurrentShift();
      onUpdateDrawer({
        ...cashDrawer,
        expenses: [
          {
            id: Date.now(),
            time: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
            cashierName: shift.cashierName,
            shiftName: shift.shiftName,
            note,
            amount: amt
          },
          ...cashDrawer.expenses
        ]
      });
    }
  };

  const handleVoidTransaction = async (trx: Transaction) => {
    if (!isOwnerMode || trx.isVoided) return;
    if (!confirm(`Batalkan (VOID) transaksi ${trx.id} senilai ${formatRupiah(trx.totalRevenue)}? Stok barang akan dikembalikan.`)) return;

    for (const item of trx.items) {
      const prod = await db.products.get(item.id);
      if (prod) {
        const optimisticStock = prod.stock + item.qty;
        await db.products.put({ ...prod, stock: optimisticStock });
        const serverStock = await adjustProductStockInCloud(userId, item.id, item.qty);
        if (serverStock !== null) {
          await db.products.update(item.id, { stock: serverStock });
        }
      }
    }

    await db.transactions.update(trx.id, { isVoided: true });
    if (supabase && navigator.onLine) {
      await supabase.from('transactions').update({ is_voided: true }).eq('user_id', userId).eq('id', trx.id);
    }
    onDataChanged();
  };

  const handleExportCSV = () => {
    if (transactions.length === 0) return alert('Belum ada data transaksi untuk di-export.');
    const headers = ['ID Transaksi', 'Status', 'Waktu', 'Kasir', 'Shift', 'Item Terjual', 'Subtotal', 'Diskon', 'Total Omzet', 'Laba Bersih', 'Metode Bayar', 'Kode Ref'];
    const rows = transactions.map((trx) => {
      const status = trx.isVoided ? 'VOID' : 'VALID';
      const waktu = new Date(trx.timestamp).toLocaleString('id-ID');
      const items = trx.items.map((i) => `${i.name} (${i.qty}x)`).join('; ');
      return [
        trx.id,
        status,
        `"${waktu}"`,
        `"${trx.cashierName || '-'}"`,
        `"${trx.shiftName || '-'}"`,
        `"${items}"`,
        trx.subtotal,
        trx.discountAmount,
        trx.isVoided ? 0 : trx.totalRevenue,
        trx.isVoided ? 0 : trx.totalProfit,
        trx.paymentMethod,
        `"${trx.refCode || '-'}"`
      ].join(',');
    });
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows].join('\n');
    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csvContent));
    link.setAttribute('download', `Laporan_Kasir_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div>
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Total Omzet Bersih</div>
          <div className="stat-value">{formatRupiah(totalRevenue)}</div>
        </div>
        {isOwnerMode && (
          <div className="stat-card green">
            <div className="stat-label">Estimasi Laba Bersih (Owner)</div>
            <div className="stat-value" style={{ color: '#16a34a' }}>{formatRupiah(totalProfit)}</div>
          </div>
        )}
        <div className="stat-card amber">
          <div className="stat-label">Pemasukan Tunai</div>
          <div className="stat-value">{formatRupiah(totalCash)}</div>
        </div>
        <div className="stat-card purple">
          <div className="stat-label">Pemasukan QRIS / Transfer</div>
          <div className="stat-value">{formatRupiah(totalNonCash)}</div>
        </div>
        <div className="stat-card teal">
          <div className="stat-label">Saldo Tunai di Laci Kasir</div>
          <div className="stat-value" style={{ color: '#0d9488' }}>{formatRupiah(expectedDrawerCash)}</div>
        </div>
      </div>

      {isOwnerMode && (
        <div className="panel" style={{ marginBottom: 18 }}>
          <h2 style={{ fontSize: '1rem', marginBottom: 12 }}>Grafik Omzet Harian (7 Hari Terakhir)</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 10, alignItems: 'end', height: 170, paddingTop: 20 }}>
            {last7Days.map((day) => {
              const heightPct = day.total > 0 ? Math.max(8, Math.round((day.total / maxDailyRevenue) * 100)) : 3;
              return (
                <div key={day.key} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', justifyContent: 'flex-end' }}>
                  <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#1e293b', marginBottom: 4, textAlign: 'center' }}>
                    {day.total > 0 ? formatRupiah(day.total).replace('Rp', '').trim() : '0'}
                  </div>
                  <div
                    title={`${day.label}: ${formatRupiah(day.total)}`}
                    style={{
                      width: '100%',
                      maxWidth: 44,
                      height: `${heightPct}%`,
                      background: day.total > 0 ? 'linear-gradient(180deg, #2563eb, #3b82f6)' : '#e2e8f0',
                      borderRadius: '6px 6px 0 0',
                      transition: 'height 0.3s ease'
                    }}
                  />
                  <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: 6, textAlign: 'center' }}>
                    {day.label}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {isOwnerMode && shiftSummaries.length > 0 && (
        <div className="panel" style={{ marginBottom: 18 }}>
          <h2 style={{ fontSize: '1rem', marginBottom: 10 }}>Rekap Penjualan per Shift</h2>
          <div className="top-products-bar">
            {shiftSummaries.map((s) => (
              <div key={s.shiftName} className="top-item-card" style={{ borderLeft: '4px solid #2563eb' }}>
                <div style={{ fontSize: '0.78rem', color: '#2563eb', fontWeight: 'bold' }}>{s.shiftName}</div>
                <div style={{ fontWeight: 'bold', fontSize: '1rem', margin: '3px 0' }}>{formatRupiah(s.revenue)}</div>
                <div style={{ fontSize: '0.8rem', color: '#475569' }}>
                  {s.count} transaksi • Tunai: {formatRupiah(s.cash)} • Non-Tunai: {formatRupiah(s.nonCash)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {isOwnerMode && (
        <div className="panel" style={{ marginBottom: 18 }}>
          <h2 style={{ fontSize: '1rem', marginBottom: 10 }}>Top 5 Barang Terlaris (Berdasarkan Filter)</h2>
          <div className="top-products-bar">
            {topProducts.length === 0 ? (
              <div style={{ color: '#6b7280', fontSize: '0.85rem' }}>Belum ada data penjualan barang.</div>
            ) : (
              topProducts.map((item, idx) => (
                <div key={item.name} className="top-item-card">
                  <div style={{ fontSize: '0.75rem', color: '#b45309', fontWeight: 'bold' }}>Peringkat #{idx + 1}</div>
                  <div style={{ fontWeight: 'bold', margin: '2px 0' }}>{item.name}</div>
                  <div style={{ fontSize: '0.82rem', color: '#374151' }}>
                    Terjual: <strong>{item.qty} pcs</strong> ({formatRupiah(item.revenue)})
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      <div className="drawer-box">
        <div>
          <strong>Manajemen Kas Laci Harian:</strong><br />
          <small style={{ color: '#475569' }}>
            Modal Awal: <strong>{formatRupiah(cashDrawer.openingCash)}</strong> • Total Pengeluaran Kas Kecil:{' '}
            <strong style={{ color: '#dc2626' }}>{formatRupiah(totalExpenses)}</strong>
          </small>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button type="button" className="btn-sm btn-edit" onClick={handleSetOpeningCash}>Atur Modal Awal Laci</button>
          <button type="button" className="btn-sm btn-hold" onClick={handleAddExpense}>Catat Pengeluaran Kas</button>
          <button type="button" className="btn-sm btn-print-sm" onClick={() => setShowExpenseList(true)}>
            Lihat Pengeluaran ({cashDrawer.expenses.length})
          </button>
        </div>
      </div>

      <div className="panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h2 style={{ border: 'none', margin: 0, padding: 0 }}>Riwayat Transaksi</h2>
            <select
              style={{ width: 'auto', margin: 0, padding: '6px 10px', fontSize: '0.85rem' }}
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value as 'ALL' | 'TODAY' | 'YESTERDAY')}
            >
              <option value="ALL">Semua Waktu</option>
              <option value="TODAY">Hari Ini</option>
              <option value="YESTERDAY">Kemarin</option>
            </select>
            <select
              style={{ width: 'auto', margin: 0, padding: '6px 10px', fontSize: '0.85rem' }}
              value={shiftFilter}
              onChange={(e) => setShiftFilter(e.target.value)}
            >
              <option value="ALL">Semua Shift</option>
              <option value="Shift Pagi">Shift Pagi</option>
              <option value="Shift Siang">Shift Siang</option>
              <option value="Shift Malam">Shift Malam</option>
              <option value="Full Day">Full Day</option>
            </select>
          </div>
          {isOwnerMode && (
            <button className="btn-export" onClick={handleExportCSV}>Export ke CSV (Excel)</button>
          )}
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>ID Transaksi</th>
                <th>Waktu</th>
                <th>Kasir & Shift</th>
                <th>Item Terjual</th>
                <th>Diskon</th>
                <th>Metode & Kode Ref</th>
                <th>Total Omzet</th>
                {isOwnerMode && <th>Laba Bersih</th>}
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {filteredTrx.length === 0 ? (
                <tr>
                  <td colSpan={isOwnerMode ? 9 : 8} style={{ textAlign: 'center', color: '#6b7280' }}>
                    Belum ada transaksi pada periode/shift ini
                  </td>
                </tr>
              ) : (
                filteredTrx.map((t) => (
                  <tr key={t.id} className={t.isVoided ? 'row-voided' : ''}>
                    <td>
                      <strong>{t.id}</strong>
                      {t.isVoided && <span className="badge-void">VOID</span>}
                    </td>
                    <td>{new Date(t.timestamp).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                    <td>
                      <div><strong>{t.cashierName || '-'}</strong></div>
                      <small style={{ color: '#64748b' }}>{t.shiftName || '-'}</small>
                    </td>
                    <td>{t.items.map((i) => `${i.name} (${i.qty}x)`).join(', ')}</td>
                    <td>{t.discountAmount > 0 ? `-${formatRupiah(t.discountAmount)}` : '-'}</td>
                    <td>
                      <strong>{t.paymentMethod}</strong>
                      {t.refCode && <><br /><span className="ref-code-tag">Ref: {t.refCode}</span></>}
                    </td>
                    <td><strong>{formatRupiah(t.totalRevenue)}</strong></td>
                    {isOwnerMode && <td style={{ color: '#16a34a', fontWeight: 'bold' }}>+{formatRupiah(t.totalProfit)}</td>}
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn-sm btn-print-sm" onClick={() => setReprintTrx(t)}>Struk</button>
                      {isOwnerMode && !t.isVoided && (
                        <button className="btn-sm btn-void" onClick={() => handleVoidTransaction(t)}>Void</button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showExpenseList && (
        <div className="modal-overlay">
          <div className="modal-box">
            <h3 style={{ marginTop: 0, fontSize: '1.05rem' }}>Rincian Pengeluaran Kas Kecil</h3>
            {cashDrawer.expenses.length === 0 ? (
              <p style={{ color: '#6b7280', textAlign: 'center' }}>Belum ada pengeluaran kas kecil.</p>
            ) : (
              cashDrawer.expenses.map((exp, idx) => (
                <div key={exp.id} className="held-item">
                  <div>
                    <strong>{exp.note}</strong>{' '}
                    <small style={{ color: '#6b7280' }}>
                      ({exp.time}{exp.cashierName ? ` • ${exp.cashierName}` : ''})
                    </small>
                    <br />
                    <strong style={{ color: '#dc2626' }}>-{formatRupiah(exp.amount)}</strong>
                  </div>
                  {isOwnerMode && (
                    <button
                      className="btn-sm btn-del"
                      onClick={() => onUpdateDrawer({ ...cashDrawer, expenses: cashDrawer.expenses.filter((_, i) => i !== idx) })}
                    >
                      Hapus
                    </button>
                  )}
                </div>
              ))
            )}
            <button className="btn-close" style={{ width: '100%', marginTop: 10 }} onClick={() => setShowExpenseList(false)}>Tutup</button>
          </div>
        </div>
      )}

      {reprintTrx && (
        <div className="modal-overlay">
          <div className="modal-box" style={{ maxWidth: 340 }}>
            <h3 style={{ marginTop: 0, textAlign: 'center', fontSize: '1rem' }}>Cetak Ulang Struk</h3>
            <div id="receiptPrintArea" className="receipt-paper">
              {reprintTrx.isVoided && <div className="rec-center"><strong>*** TRANSAKSI BATAL (VOID) ***</strong><div className="rec-divider" /></div>}
              <div className="rec-center">
                <strong>{storeSettings.storeName}</strong><br />
                {storeSettings.storeAddress}<br />
                Telp: {storeSettings.storePhone}
              </div>
              <div className="rec-divider" />
              <div>No: {reprintTrx.id}</div>
              <div>Tgl: {new Date(reprintTrx.timestamp).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })}</div>
              {reprintTrx.cashierName && (
                <div>Kasir: {reprintTrx.cashierName} ({reprintTrx.shiftName || '-'})</div>
              )}
              <div className="rec-divider" />
              {reprintTrx.items.map((item) => {
                const unitPrice = item.appliedPrice ?? item.sellPrice;
                return (
                  <div key={item.id}>
                    <div>{item.name}{item.isWholesale ? ' (Grosir)' : ''}</div>
                    <div className="rec-row">
                      <span>{item.qty} x {unitPrice.toLocaleString('id-ID')}</span>
                      <span>{(item.qty * unitPrice).toLocaleString('id-ID')}</span>
                    </div>
                  </div>
                );
              })}
              <div className="rec-divider" />
              <div className="rec-row"><strong>TOTAL</strong><strong>{formatRupiah(reprintTrx.totalRevenue)}</strong></div>
              <div>Metode: {reprintTrx.paymentMethod} {reprintTrx.refCode ? `(Ref: ${reprintTrx.refCode})` : ''}</div>
              <div className="rec-divider" />
              <div className="rec-center">{storeSettings.receiptFooter}</div>
            </div>
            <div className="modal-actions">
              <button
                className="btn-print"
                onClick={() => {
                  document.body.classList.remove('printing-receipt', 'printing-label');
                  document.body.classList.add('printing-receipt');
                  window.print();
                }}
              >
                Cetak Struk
              </button>
              <button className="btn-close" onClick={() => setReprintTrx(null)}>Tutup</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};