import React, { useState } from 'react';
import { db } from '../db/localDb';
import { syncProductToCloud, deleteProductFromCloud, adjustProductStockInCloud } from '../db/supabaseClient';
import { formatRupiah, generateBarcode } from '../utils/helpers';
import type { Product, StoreSettings } from '../types/pos';

interface ProductsPageProps {
  userId: string;
  products: Product[];
  storeSettings: StoreSettings;
  onDataChanged: () => void;
}

export const ProductsPage: React.FC<ProductsPageProps> = ({ userId, products, storeSettings, onDataChanged }) => {
  const [editId, setEditId] = useState<string | null>(null);
  const [barcode, setBarcode] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('Makanan');
  const [costPrice, setCostPrice] = useState<number>(0);
  const [sellPrice, setSellPrice] = useState<number>(0);
  const [wholesaleMinQty, setWholesaleMinQty] = useState<number>(0);
  const [wholesalePrice, setWholesalePrice] = useState<number>(0);
  const [stock, setStock] = useState<number>(0);

  const [tableSearch, setTableSearch] = useState('');
  const [onlyLowStock, setOnlyLowStock] = useState(false);
  const [labelProduct, setLabelProduct] = useState<Product | null>(null);
  const [showCsvModal, setShowCsvModal] = useState(false);
  const [importingCsv, setImportingCsv] = useState(false);

  const resetForm = () => {
    setEditId(null);
    setBarcode('');
    setName('');
    setCategory('Makanan');
    setCostPrice(0);
    setSellPrice(0);
    setWholesaleMinQty(0);
    setWholesalePrice(0);
    setStock(0);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const duplicate = products.find((p) => p.barcode === barcode.trim() && p.id !== editId);
    if (duplicate) {
      return alert(`Gagal! Kode barcode "${barcode.trim()}" sudah digunakan oleh barang "${duplicate.name}".`);
    }

    if ((wholesaleMinQty > 0 || wholesalePrice > 0) && (wholesaleMinQty < 2 || wholesalePrice <= 0)) {
      return alert('Jika mengisi harga grosir, Minimal Qty harus ≥ 2 pcs dan Harga Grosir harus lebih dari Rp 0.');
    }

    const productData: Product = {
      id: editId || 'BRG-' + Date.now().toString().slice(-5),
      barcode: barcode.trim(),
      name: name.trim(),
      category: category.trim(),
      costPrice,
      sellPrice,
      wholesaleMinQty: wholesaleMinQty >= 2 ? wholesaleMinQty : 0,
      wholesalePrice: wholesaleMinQty >= 2 && wholesalePrice > 0 ? wholesalePrice : 0,
      stock
    };
    await db.products.put(productData);
    await syncProductToCloud(userId, productData);
    resetForm();
    onDataChanged();
  };

  const handleEdit = (p: Product) => {
    setEditId(p.id);
    setBarcode(p.barcode);
    setName(p.name);
    setCategory(p.category);
    setCostPrice(p.costPrice);
    setSellPrice(p.sellPrice);
    setWholesaleMinQty(p.wholesaleMinQty || 0);
    setWholesalePrice(p.wholesalePrice || 0);
    setStock(p.stock);
  };

  const handleQuickAddStock = async (p: Product) => {
    const val = prompt(`Tambah stok masuk untuk "${p.name}" (Stok saat ini: ${p.stock}):`, '10');
    if (val === null) return;
    const addQty = Number(val);
    if (!isNaN(addQty) && addQty > 0) {
      await db.products.put({ ...p, stock: p.stock + addQty });
      const serverStock = await adjustProductStockInCloud(userId, p.id, addQty);
      if (serverStock !== null) {
        await db.products.update(p.id, { stock: serverStock });
      }
      onDataChanged();
    }
  };

  const handleOpname = async (p: Product) => {
    const val = prompt(`Stok Opname "${p.name}" (Sistem: ${p.stock} pcs). Masukkan stok fisik asli:`, String(p.stock));
    if (val === null) return;
    const actual = Number(val);
    if (!isNaN(actual) && actual >= 0) {
      const updated = { ...p, stock: actual };
      await db.products.put(updated);
      await syncProductToCloud(userId, updated);
      onDataChanged();
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Hapus produk ini?')) return;
    await db.products.delete(id);
    await deleteProductFromCloud(userId, id);
    onDataChanged();
  };

  const handleDownloadCsvTemplate = () => {
    const sample = [
      'barcode,nama,kategori,harga_modal,harga_jual,min_grosir,harga_grosir,stok',
      '8991001,Kopi Kapal Api 165g,Minuman,12000,15000,5,14000,30',
      '8991002,Indomie Goreng,Makanan,2700,3500,10,3200,80'
    ].join('\n');
    const blob = new Blob([sample], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Template_Import_Produk.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCsvUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportingCsv(true);

    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (lines.length < 2) {
        alert('File CSV kosong atau hanya berisi baris header.');
        return;
      }

      const sep = lines[0].includes(';') ? ';' : ',';
      const usedBarcodes = products.map((p) => p.barcode);
      let importedCount = 0;

      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(sep).map((c) => c.replace(/^"|"$/g, '').trim());
        const itemName = cols[1];
        if (!itemName) continue;

        let itemBarcode = cols[0];
        if (!itemBarcode || usedBarcodes.includes(itemBarcode)) {
          itemBarcode = generateBarcode(usedBarcodes);
        }
        usedBarcodes.push(itemBarcode);

        const itemCat = cols[2] || 'Umum';
        const itemCost = Math.max(0, Number(cols[3]) || 0);
        const itemSell = Math.max(0, Number(cols[4]) || 0);
        const itemMinGrosir = Math.max(0, Number(cols[5]) || 0);
        const itemHargaGrosir = Math.max(0, Number(cols[6]) || 0);
        const itemStock = Math.max(0, Number(cols[7]) || 0);

        const newProd: Product = {
          id: 'BRG-' + (Date.now() + i).toString().slice(-6),
          barcode: itemBarcode,
          name: itemName,
          category: itemCat,
          costPrice: itemCost,
          sellPrice: itemSell,
          wholesaleMinQty: itemMinGrosir >= 2 ? itemMinGrosir : 0,
          wholesalePrice: itemMinGrosir >= 2 && itemHargaGrosir > 0 ? itemHargaGrosir : 0,
          stock: itemStock
        };

        await db.products.put(newProd);
        await syncProductToCloud(userId, newProd);
        importedCount++;
      }

      alert(`Berhasil mengimpor ${importedCount} produk ke katalog!`);
      setShowCsvModal(false);
      onDataChanged();
    } finally {
      setImportingCsv(false);
      e.target.value = '';
    }
  };

  const filteredProducts = products.filter((p) => {
    const kw = tableSearch.toLowerCase();
    const matchText = p.name.toLowerCase().includes(kw) || p.barcode.includes(kw) || p.category.toLowerCase().includes(kw);
    const matchLow = !onlyLowStock || p.stock <= 5;
    return matchText && matchLow;
  });

  return (
    <div className="manage-grid">
      <div className="panel">
        <h2>{editId ? 'Edit Produk' : 'Tambah Produk Baru'}</h2>
        <form onSubmit={handleSave}>
          <label>Kode Barcode</label>
          <div className="barcode-input-group">
            <input type="text" placeholder="Scan atau klik Auto..." value={barcode} onChange={(e) => setBarcode(e.target.value)} required />
            <button
              type="button"
              className="btn-gen-barcode"
              onClick={() => setBarcode(generateBarcode(products.map((p) => p.barcode)))}
            >
              Auto Barcode
            </button>
          </div>
          <label>Nama Barang</label>
          <input type="text" placeholder="Contoh: Kopi Kapal Api 165g" value={name} onChange={(e) => setName(e.target.value)} required />
          <label>Kategori</label>
          <input type="text" value={category} onChange={(e) => setCategory(e.target.value)} required />
          <label>Harga Modal (Rp)</label>
          <input type="number" min={0} value={costPrice || ''} onChange={(e) => setCostPrice(Number(e.target.value) || 0)} required />
          <label>Harga Jual Eceran (Rp)</label>
          <input type="number" min={0} value={sellPrice || ''} onChange={(e) => setSellPrice(Number(e.target.value) || 0)} required />

          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: 10, marginBottom: 10 }}>
            <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#166534', marginBottom: 6 }}>
              Harga Grosir Bertingkat (Opsional)
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div>
                <label style={{ fontSize: '0.78rem' }}>Min. Beli (pcs)</label>
                <input
                  type="number"
                  min={0}
                  placeholder="Contoh: 5"
                  value={wholesaleMinQty || ''}
                  onChange={(e) => setWholesaleMinQty(Number(e.target.value) || 0)}
                  style={{ marginBottom: 0 }}
                />
              </div>
              <div>
                <label style={{ fontSize: '0.78rem' }}>Harga Grosir (Rp)</label>
                <input
                  type="number"
                  min={0}
                  placeholder="Contoh: 14000"
                  value={wholesalePrice || ''}
                  onChange={(e) => setWholesalePrice(Number(e.target.value) || 0)}
                  style={{ marginBottom: 0 }}
                />
              </div>
            </div>
          </div>

          <label>Stok (pcs)</label>
          <input type="number" min={0} value={stock || ''} onChange={(e) => setStock(Number(e.target.value) || 0)} required />
          <button type="submit" className="btn-primary">{editId ? 'Update Produk' : 'Simpan Produk'}</button>
          {editId && <button type="button" className="btn-close" style={{ width: '100%', marginTop: 8 }} onClick={resetForm}>Batal Edit</button>}
        </form>
      </div>

      <div className="panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ border: 'none', margin: 0, padding: 0 }}>Daftar Stok Barang & Opname Rak</h2>
          <button type="button" className="btn-sm btn-edit" onClick={() => setShowCsvModal(true)}>
            + Import CSV Massal
          </button>
        </div>
        <div className="table-toolbar">
          <input
            type="text"
            placeholder="Cari nama barang atau barcode di tabel..."
            value={tableSearch}
            onChange={(e) => setTableSearch(e.target.value)}
          />
          <button
            type="button"
            className={`btn-filter-low ${onlyLowStock ? 'active' : ''}`}
            onClick={() => setOnlyLowStock(!onlyLowStock)}
          >
            Stok Menipis (≤ 5)
          </button>
        </div>

        <div style={{ overflowX: 'auto', maxHeight: '65vh' }}>
          <table>
            <thead>
              <tr>
                <th>Barcode</th>
                <th>Nama</th>
                <th>Kategori</th>
                <th>Modal</th>
                <th>Jual / Grosir</th>
                <th>Stok</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {filteredProducts.map((p) => {
                const hasWholesale = (p.wholesaleMinQty || 0) > 1 && (p.wholesalePrice || 0) > 0;
                return (
                  <tr key={p.id}>
                    <td><code>{p.barcode}</code></td>
                    <td><strong>{p.name}</strong></td>
                    <td><span className="cat-badge">{p.category}</span></td>
                    <td>{formatRupiah(p.costPrice)}</td>
                    <td>
                      <div>{formatRupiah(p.sellPrice)}</div>
                      {hasWholesale && (
                        <small style={{ color: '#15803d', fontWeight: 600 }}>
                          Grosir ≥{p.wholesaleMinQty}: {formatRupiah(p.wholesalePrice!)}
                        </small>
                      )}
                    </td>
                    <td style={{ fontWeight: 'bold', color: p.stock <= 5 ? '#dc2626' : 'inherit' }}>{p.stock}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn-sm btn-stock" onClick={() => handleQuickAddStock(p)}>+Stok</button>
                      <button className="btn-sm btn-opname" onClick={() => handleOpname(p)}>Opname</button>
                      <button className="btn-sm btn-label" onClick={() => setLabelProduct(p)}>Label</button>
                      <button className="btn-sm btn-edit" onClick={() => handleEdit(p)}>Edit</button>
                      <button className="btn-sm btn-del" onClick={() => handleDelete(p.id)}>Hapus</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {showCsvModal && (
        <div className="modal-overlay">
          <div className="modal-box" style={{ maxWidth: 420 }}>
            <h3 style={{ marginTop: 0, fontSize: '1.05rem' }}>Import Produk Massal (CSV)</h3>
            <p style={{ fontSize: '0.84rem', color: '#475569' }}>
              Format kolom CSV: <code>barcode,nama,kategori,harga_modal,harga_jual,min_grosir,harga_grosir,stok</code>.
              Jika kolom barcode dikosongkan, sistem otomatis membuatkan barcode unik.
            </p>
            <button
              type="button"
              className="btn-sm btn-stock"
              style={{ marginBottom: 12 }}
              onClick={handleDownloadCsvTemplate}
            >
              Download Contoh Template CSV
            </button>
            <input
              type="file"
              accept=".csv,text/csv"
              disabled={importingCsv}
              onChange={handleCsvUpload}
            />
            {importingCsv && <p style={{ fontSize: '0.85rem', color: '#2563eb' }}>Mengimpor data produk...</p>}
            <button className="btn-close" style={{ width: '100%', marginTop: 10 }} onClick={() => setShowCsvModal(false)}>
              Tutup
            </button>
          </div>
        </div>
      )}

      {labelProduct && (
        <div className="modal-overlay">
          <div className="modal-box" style={{ maxWidth: 340 }}>
            <h3 style={{ marginTop: 0, textAlign: 'center', fontSize: '1rem' }}>Preview Label Harga Rak</h3>
            <div id="shelfLabelPrintArea" className="shelf-label-paper">
              <div style={{ fontSize: '0.75rem', fontWeight: 'bold', borderBottom: '1px solid #000', paddingBottom: 3, marginBottom: 5 }}>
                {storeSettings.storeName}
              </div>
              <div style={{ fontSize: '0.95rem', fontWeight: 'bold', marginBottom: 4 }}>{labelProduct.name}</div>
              <div style={{ fontSize: '1.35rem', fontWeight: 900, margin: '6px 0' }}>{formatRupiah(labelProduct.sellPrice)}</div>
              {(labelProduct.wholesaleMinQty || 0) > 1 && (labelProduct.wholesalePrice || 0) > 0 && (
                <div style={{ fontSize: '0.78rem', fontWeight: 'bold', marginBottom: 4 }}>
                  Grosir min. {labelProduct.wholesaleMinQty} pcs: {formatRupiah(labelProduct.wholesalePrice!)}/pcs
                </div>
              )}
              <div style={{ fontFamily: 'monospace', fontSize: '0.85rem', letterSpacing: 2, borderTop: '1px dashed #000', paddingTop: 4 }}>
                *{labelProduct.barcode}*
              </div>
            </div>
            <div className="modal-actions">
              <button
                className="btn-print"
                onClick={() => {
                  document.body.classList.remove('printing-receipt', 'printing-label');
                  document.body.classList.add('printing-label');
                  window.print();
                }}
              >
                Cetak Label Rak
              </button>
              <button className="btn-close" onClick={() => setLabelProduct(null)}>Tutup</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};