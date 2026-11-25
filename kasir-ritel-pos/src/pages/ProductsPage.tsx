import React, { useState } from 'react';
import { db } from '../db/localDb';
import { syncProductToCloud, deleteProductFromCloud } from '../db/supabaseClient';
import { formatRupiah, generateBarcode } from '../utils/helpers';
import type { Product, StoreSettings } from '../types/pos';

interface ProductsPageProps {
  products: Product[];
  storeSettings: StoreSettings;
  onDataChanged: () => void;
}

export const ProductsPage: React.FC<ProductsPageProps> = ({ products, storeSettings, onDataChanged }) => {
  const [editId, setEditId] = useState<string | null>(null);
  const [barcode, setBarcode] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('Makanan');
  const [costPrice, setCostPrice] = useState<number>(0);
  const [sellPrice, setSellPrice] = useState<number>(0);
  const [stock, setStock] = useState<number>(0);

  const [tableSearch, setTableSearch] = useState('');
  const [onlyLowStock, setOnlyLowStock] = useState(false);
  const [labelProduct, setLabelProduct] = useState<Product | null>(null);

  const resetForm = () => {
    setEditId(null);
    setBarcode('');
    setName('');
    setCategory('Makanan');
    setCostPrice(0);
    setSellPrice(0);
    setStock(0);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const duplicate = products.find((p) => p.barcode === barcode.trim() && p.id !== editId);
    if (duplicate) {
      return alert(`Gagal! Kode barcode "${barcode.trim()}" sudah digunakan oleh barang "${duplicate.name}".`);
    }

    const productData: Product = {
      id: editId || 'BRG-' + Date.now().toString().slice(-5),
      barcode: barcode.trim(),
      name: name.trim(),
      category: category.trim(),
      costPrice,
      sellPrice,
      stock
    };
    await db.products.put(productData);
    await syncProductToCloud(productData);
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
    setStock(p.stock);
  };

  const handleQuickAddStock = async (p: Product) => {
    const val = prompt(`Tambah stok masuk untuk "${p.name}" (Stok saat ini: ${p.stock}):`, '10');
    if (val === null) return;
    const addQty = Number(val);
    if (!isNaN(addQty) && addQty > 0) {
      const updated = { ...p, stock: p.stock + addQty };
      await db.products.put(updated);
      await syncProductToCloud(updated);
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
      await syncProductToCloud(updated);
      onDataChanged();
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Hapus produk ini?')) return;
    await db.products.delete(id);
    await deleteProductFromCloud(id);
    onDataChanged();
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
          <label>Harga Jual (Rp)</label>
          <input type="number" min={0} value={sellPrice || ''} onChange={(e) => setSellPrice(Number(e.target.value) || 0)} required />
          <label>Stok (pcs)</label>
          <input type="number" min={0} value={stock || ''} onChange={(e) => setStock(Number(e.target.value) || 0)} required />
          <button type="submit" className="btn-primary">{editId ? 'Update Produk' : 'Simpan Produk'}</button>
          {editId && <button type="button" className="btn-close" style={{ width: '100%', marginTop: 8 }} onClick={resetForm}>Batal Edit</button>}
        </form>
      </div>

      <div className="panel">
        <h2>Daftar Stok Barang & Opname Rak</h2>
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
                <th>Jual</th>
                <th>Stok</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {filteredProducts.map((p) => (
                <tr key={p.id}>
                  <td><code>{p.barcode}</code></td>
                  <td><strong>{p.name}</strong></td>
                  <td><span className="cat-badge">{p.category}</span></td>
                  <td>{formatRupiah(p.costPrice)}</td>
                  <td>{formatRupiah(p.sellPrice)}</td>
                  <td style={{ fontWeight: 'bold', color: p.stock <= 5 ? '#dc2626' : 'inherit' }}>{p.stock}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn-sm btn-stock" onClick={() => handleQuickAddStock(p)}>+Stok</button>
                    <button className="btn-sm btn-opname" onClick={() => handleOpname(p)}>Opname</button>
                    <button className="btn-sm btn-label" onClick={() => setLabelProduct(p)}>Label</button>
                    <button className="btn-sm btn-edit" onClick={() => handleEdit(p)}>Edit</button>
                    <button className="btn-sm btn-del" onClick={() => handleDelete(p.id)}>Hapus</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL CETAK LABEL RAK */}
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