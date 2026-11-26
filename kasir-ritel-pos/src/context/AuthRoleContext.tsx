import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase } from '../db/supabaseClient';

export const DEFAULT_PASS_HASH = '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9'; // admin123
const OWNER_IDLE_TIMEOUT_MS = 3 * 60 * 1000;

export async function hashTextSHA256(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

interface AuthRoleContextType {
  isOwnerMode: boolean;
  passwordHash: string;
  loginOwner: (password: string) => Promise<boolean>;
  logoutOwner: (isAuto?: boolean) => void;
  changeOwnerPassword: (newPassword: string) => Promise<string>;
  applyCloudPasswordHash: (hash: string) => void;
}

const AuthRoleContext = createContext<AuthRoleContextType | undefined>(undefined);

export const AuthRoleProvider: React.FC<{
  children: React.ReactNode;
  userId?: string;
  initialHash?: string;
}> = ({ children, userId, initialHash }) => {
  const [isOwnerMode, setIsOwnerMode] = useState(false);
  const [passwordHash, setPasswordHash] = useState<string>(initialHash || DEFAULT_PASS_HASH);

  useEffect(() => {
    // Hapus sisa penyimpanan lokal lama agar password murni mengikuti akun cloud
    localStorage.removeItem('kasir_owner_pass_hash');
  }, []);

  useEffect(() => {
    if (initialHash) {
      setPasswordHash(initialHash);
    }
  }, [initialHash]);

  const logoutOwner = useCallback((isAuto = false) => {
    setIsOwnerMode(false);
    if (isAuto) {
      alert('Mode Owner terkunci otomatis karena tidak ada aktivitas selama 3 menit.');
    }
  }, []);

  useEffect(() => {
    if (!isOwnerMode) return;
    let timer = setTimeout(() => logoutOwner(true), OWNER_IDLE_TIMEOUT_MS);

    const resetTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(() => logoutOwner(true), OWNER_IDLE_TIMEOUT_MS);
    };

    const events = ['mousemove', 'keydown', 'click'];
    events.forEach((evt) => window.addEventListener(evt, resetTimer));
    return () => {
      clearTimeout(timer);
      events.forEach((evt) => window.removeEventListener(evt, resetTimer));
    };
  }, [isOwnerMode, logoutOwner]);

  const loginOwner = async (password: string): Promise<boolean> => {
    const inputHash = await hashTextSHA256(password);
    let latestAccountHash = passwordHash;

    // Ambil hash password Owner paling baru langsung dari akun Supabase
    if (supabase && navigator.onLine && userId) {
      const { data: configData } = await supabase
        .from('store_config')
        .select('owner_pass_hash')
        .eq('user_id', userId)
        .maybeSingle();

      if (configData?.owner_pass_hash) {
        latestAccountHash = configData.owner_pass_hash;
        setPasswordHash(latestAccountHash);
      } else {
        const { data: userData } = await supabase.auth.getUser();
        const metaHash = userData.user?.user_metadata?.owner_pass_hash as string | undefined;
        if (metaHash) {
          latestAccountHash = metaHash;
          setPasswordHash(metaHash);
        }
      }
    }

    if (inputHash === latestAccountHash) {
      setIsOwnerMode(true);
      return true;
    }
    return false;
  };

  const changeOwnerPassword = async (newPassword: string): Promise<string> => {
    const newHash = await hashTextSHA256(newPassword);
    setPasswordHash(newHash);

    if (supabase) {
      await supabase.auth.updateUser({
        data: { owner_pass_hash: newHash }
      });

      if (userId) {
        await supabase
          .from('store_config')
          .update({
            owner_pass_hash: newHash,
            updated_at: new Date().toISOString()
          })
          .eq('user_id', userId);
      }
    }

    return newHash;
  };

  const applyCloudPasswordHash = useCallback((hash: string) => {
    if (!hash) return;
    setPasswordHash(hash);
  }, []);

  return (
    <AuthRoleContext.Provider
      value={{
        isOwnerMode,
        passwordHash,
        loginOwner,
        logoutOwner,
        changeOwnerPassword,
        applyCloudPasswordHash
      }}
    >
      {children}
    </AuthRoleContext.Provider>
  );
};

export const useAuthRole = () => {
  const ctx = useContext(AuthRoleContext);
  if (!ctx) throw new Error('useAuthRole harus digunakan di dalam AuthRoleProvider');
  return ctx;
};