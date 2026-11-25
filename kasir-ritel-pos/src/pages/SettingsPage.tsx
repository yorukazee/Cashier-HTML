import React, { useState } from 'react';
import { db } from '../db/localDb';
import { syncProductToCloud, syncPendingTransactions } from '../db/supabaseClient';
import { useAuthRole } from '../context/AuthRoleContext';
import type { Product, Transaction, CashDrawer, StoreSettings } from '../types/pos';

interface SettingsPageProps {
  userId: string;
  settings: StoreSettings;
  products: Product[];
  transactions: Transaction[];
  cashDrawer: CashDrawer;
  onSaveSettings: (newSettings: StoreSettings) => void;
  onRestoreAll: (data: {
    storeSettings?: StoreSettings;
    products: Product[];
    transactions: Transaction[];
    cashDrawer?: CashDrawer;
  }) => Promise<void>;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({
  userId,
  settings,
  products,
  transactions,
  cashDrawer,
  onSaveSettings,
  onRestoreAll
}) => {
  const { changeOwnerPassword } = useAuthRole();
  const [form, setForm] = useState<StoreSettings>(settings);
  const [newPass, setNewPass] = useState('');
  const [confirmPass, setConfirmPass] = useState('');

  const handleQrisUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxSize = 360;
        let w = img.width;
        let h = img.height;
        if (w > maxSize || h > maxSize) {
          if (w > h) {
            h = Math.round((h * maxSize) / w);
            w = maxSize;
          } else {
            w = Math.round((w * maxSize) / h);
            h = maxSize;
          }
        }
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d')?.drawImage(img, 0, 0, w, h);
        setForm({ ...form, qrisImageDataUrl: canvas.toDataURL('image/jpeg', 0.85) });
      };
      img.src = String(ev.target?.result || '');
    };
    reader.readAsDataURL(file);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveSettings(form);
    alert('Pengaturan toko & QRIS berhasil disimpan!');
  };

  const handlePassChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPass.length < 4) return alert('Minimal 4 karakter!');
    if (newPass !== confirmPass) return alert('Konfirmasi kata sandi tidak cocok!');
    await changeOwnerPassword(newPass);
    setNewPass('');
    setConfirmPass('');
    alert('Kata sandi Owner berhasil diperbarui!');
  };

  const handleDownloadBackup = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      storeSettings: form,
      products,
      transactionHistory: transactions,
      cashDrawer
    };
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(payload, null, 2));
    const link = document.createElement('a');
    link.setAttribute('href', dataStr);
    link.setAttribute('download', `Backup_Kasir_${new Date().toISOString().slice(0, 10)}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleRestoreBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const parsed = JSON.parse(String(ev.target?.result || ''));
        if (!Array.isArray(parsed.products)) throw new Error('Format file backup tidak valid.');
        if (!confirm(`Pulihkan data dari backup tanggal ${parsed.exportedAt || 'ini'}? Data saat ini akan diperbarui dan disinkronkan ke cloud.`)) return;

        const restoredProducts: Product[] = parsed.products.map((p: Product) => ({
          ...p,
          category: p.category || 'Umum'
        }));
        const rawTrx = parsed.transactionHistory || parsed.transactions || [];
        const restoredTrx: Transaction[] = rawTrx.map((t: Transaction) => ({
          ...t,
          synced: false
        }));

        await db.products.clear();
        await db.products.bulkPut(restoredProducts);
        for (const prod of restoredProducts) {
          await syncProductToCloud(userId, prod);
        }

        if (restoredTrx.length > 0) {
          await db.transactions.clear();
          await db.transactions.bulkPut(restoredTrx);
          await syncPendingTransactions(userId);
        }

        if (parsed.storeSettings) setForm({ ...form, ...parsed.storeSettings });

        await onRestoreAll({
          storeSettings: parsed.storeSettings,
          products: restoredProducts,
          transactions: restoredTrx,
          cashDrawer: parsed.cashDrawer
        });
        alert('Seluruh data berhasil dipulihkan dan disinkronkan ke cloud!');
      } catch (err: unknown) {
        alert('Gagal membaca file backup: ' + (err instanceof Error ? err.message : 'Error'));
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="settings-grid">
      <div className="panel">
        <h2>Identitas Toko, QRIS & Rekening Transfer</h2>
        <form onSubmit={handleSave}>
          <label>Nama Toko</label>
          <input type="text" value={form.storeName} onChange={(e) => setForm({ ...form, storeName: e.target.value })} required />
          <label>Alamat Toko</label>
          <input type="text" value={form.storeAddress} onChange={(e) => setForm({ ...form, storeAddress: e.target.value })} required />
          <label>Nomor Telepon / WhatsApp</label>
          <input type="text" value={form.storePhone} onChange={(e) => setForm({ ...form, storePhone: e.target.value })} required />
          <label>Rekening Bank Tujuan Transfer</label>
          <input type="text" value={form.bankAccount} onChange={(e) => setForm({ ...form, bankAccount: e.target.value })} />
          <label>Upload Gambar Kode QRIS Statis Toko (Opsional)</label>
          <input type="file" accept="image/*" onChange={handleQrisUpload} />
          {form.qrisImageDataUrl && (
            <div style={{ marginBottom: 10 }}>
              <img src={form.qrisImageDataUrl} alt="QRIS" className="qris-preview-thumb" />
              <button type="button" className="btn-sm btn-del" style={{ marginTop: 4 }} onClick={() => setForm({ ...form, qrisImageDataUrl: '' })}>
                Hapus Gambar QRIS
              </button>
            </div>
          )}
          <label>Catatan Footer Struk</label>
          <textarea rows={3} value={form.receiptFooter} onChange={(e) => setForm({ ...form, receiptFooter: e.target.value })} />
          <button type="submit" className="btn-primary">Simpan Pengaturan Toko & QRIS</button>
        </form>

        <div className="section-divider">
          <h3 style={{ margin: '0 0 8px 0', fontSize: '1rem' }}>Keamanan Mode Owner (SHA-256 & Auto-Lock 3 Menit)</h3>
          <form onSubmit={handlePassChange}>
            <label>Kata Sandi Baru Owner</label>
            <input type="password" value={newPass} onChange={(e) => setNewPass(e.target.value)} placeholder="Minimal 4 karakter..." required />
            <label>Konfirmasi Kata Sandi Baru</label>
            <input type="password" value={confirmPass} onChange={(e) => setConfirmPass(e.target.value)} placeholder="Ketik ulang kata sandi baru..." required />
            <button type="submit" className="btn-primary" style={{ background: '#d97706' }}>Ubah Kata Sandi Owner</button>
          </form>
        </div>

        <div className="section-divider">
          <h3 style={{ margin: '0 0 6px 0', fontSize: '1rem' }}>Cadangkan & Pulihkan Data (JSON)</h3>
          <div className="backup-actions">
            <button type="button" className="btn-backup" onClick={handleDownloadBackup}>Download Backup (.json)</button>
            <label className="btn-restore">
              Restore Data (.json)
              <input type="file" accept=".json" style={{ display: 'none' }} onChange={handleRestoreBackup} />
            </label>
          </div>
        </div>
      </div>

      <div className="panel">
        <h2>Preview Header & Footer Struk</h2>
        <div className="receipt-paper" style={{ marginTop: 15 }}>
          <div className="rec-center">
            <strong>{form.storeName}</strong><br />
            {form.storeAddress}<br />
            Telp: {form.storePhone}
          </div>
          <div className="rec-divider" />
          <div className="rec-row"><span>Contoh Barang x 1</span><span>10.000</span></div>
          <div className="rec-divider" />
          <div className="rec-center">{form.receiptFooter}</div>
        </div>
      </div>
    </div>
  );
};