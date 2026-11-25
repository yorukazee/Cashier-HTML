import React, { useState } from 'react';
import { supabase } from '../db/supabaseClient';

const labelStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: 6,
  fontSize: '0.88rem',
  fontWeight: 600,
  color: '#1e293b'
};

const inputStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  boxSizing: 'border-box',
  padding: '10px 12px',
  marginBottom: 14,
  borderRadius: 6,
  border: '1px solid #cbd5e1',
  fontSize: '0.95rem',
  background: '#ffffff',
  color: '#0f172a'
};

export const AuthGate: React.FC = () => {
  const [mode, setMode] = useState<'LOGIN' | 'REGISTER'>('LOGIN');
  const [storeName, setStoreName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [infoMessage, setInfoMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) {
      setErrorMessage('Koneksi Supabase belum terkonfigurasi.');
      return;
    }

    setLoading(true);
    setErrorMessage('');
    setInfoMessage('');

    try {
      if (mode === 'REGISTER') {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { store_name: storeName.trim() || 'Toko Ritel Baru' }
          }
        });

        if (error) throw error;

        if (data.user && !data.session) {
          setInfoMessage(
            `Pendaftaran berhasil! Link verifikasi telah dikirim ke ${email.trim()}. Silakan cek kotak masuk atau folder Spam, klik link verifikasi, lalu login di sini.`
          );
          setMode('LOGIN');
          setPassword('');
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password
        });

        if (error) {
          if (error.message.toLowerCase().includes('email not confirmed')) {
            throw new Error('Email belum diverifikasi! Silakan klik link verifikasi yang dikirim ke email Anda terlebih dahulu.');
          }
          throw new Error('Email atau kata sandi salah.');
        }
      }
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Terjadi kesalahan autentikasi.');
    } finally {
      setLoading(false);
    }
  };

  const handleResendVerification = async () => {
    if (!supabase || !email.trim()) {
      setErrorMessage('Masukkan alamat email Anda terlebih dahulu untuk mengirim ulang verifikasi.');
      return;
    }
    setLoading(true);
    setErrorMessage('');
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin }
    });
    setLoading(false);
    if (error) {
      setErrorMessage(error.message);
    } else {
      setInfoMessage(`Link verifikasi baru telah dikirim ulang ke ${email.trim()}.`);
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: '#1e293b', display: 'flex', justifyContent: 'center', alignItems: 'center', padding: 20 }}>
      <div className="modal-box" style={{ maxWidth: 420, width: '100%', boxSizing: 'border-box', textAlign: 'left' }}>
        <div style={{ textAlign: 'center', marginBottom: 18 }}>
          <h2 style={{ border: 'none', margin: 0, fontSize: '1.35rem', color: '#0f172a' }}>Kasir Ritel POS Cloud</h2>
          <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: '#64748b' }}>
            Sistem Kasir Multi-Toko & Pantau Omzet Real-Time
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 18 }}>
          <button
            type="button"
            onClick={() => { setMode('LOGIN'); setErrorMessage(''); setInfoMessage(''); }}
            style={{
              padding: 10,
              borderRadius: 6,
              border: 'none',
              fontWeight: 'bold',
              cursor: 'pointer',
              background: mode === 'LOGIN' ? '#2563eb' : '#e2e8f0',
              color: mode === 'LOGIN' ? '#fff' : '#334155'
            }}
          >
            Masuk Toko
          </button>
          <button
            type="button"
            onClick={() => { setMode('REGISTER'); setErrorMessage(''); setInfoMessage(''); }}
            style={{
              padding: 10,
              borderRadius: 6,
              border: 'none',
              fontWeight: 'bold',
              cursor: 'pointer',
              background: mode === 'REGISTER' ? '#2563eb' : '#e2e8f0',
              color: mode === 'REGISTER' ? '#fff' : '#334155'
            }}
          >
            Daftar Toko Baru
          </button>
        </div>

        {infoMessage && (
          <div style={{ background: '#dcfce7', border: '1px solid #86efac', color: '#166534', padding: 10, borderRadius: 6, fontSize: '0.84rem', marginBottom: 14 }}>
            {infoMessage}
          </div>
        )}

        {errorMessage && (
          <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', color: '#991b1b', padding: 10, borderRadius: 6, fontSize: '0.84rem', marginBottom: 14 }}>
            {errorMessage}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {mode === 'REGISTER' && (
            <div>
              <label style={labelStyle}>Nama Toko</label>
              <input
                type="text"
                style={inputStyle}
                placeholder="Contoh: Toko Sembako Berkah"
                value={storeName}
                onChange={(e) => setStoreName(e.target.value)}
                required
              />
            </div>
          )}

          <div>
            <label style={labelStyle}>Email Akun Toko</label>
            <input
              type="email"
              style={inputStyle}
              placeholder="nama@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div>
            <label style={labelStyle}>Kata Sandi Akun</label>
            <input
              type="password"
              style={inputStyle}
              placeholder="Minimal 6 karakter..."
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button
            type="submit"
            className="btn-primary"
            style={{ display: 'block', width: '100%', marginTop: 4, padding: 12 }}
            disabled={loading}
          >
            {loading ? 'Memproses...' : mode === 'LOGIN' ? 'Masuk ke Kasir' : 'Buat Akun & Kirim Verifikasi'}
          </button>
        </form>

        {mode === 'LOGIN' && (
          <div style={{ textAlign: 'center', marginTop: 14 }}>
            <button
              type="button"
              onClick={handleResendVerification}
              style={{ background: 'none', border: 'none', color: '#2563eb', fontSize: '0.82rem', cursor: 'pointer', textDecoration: 'underline' }}
            >
              Belum menerima email verifikasi? Kirim ulang
            </button>
          </div>
        )}
      </div>
    </div>
  );
};