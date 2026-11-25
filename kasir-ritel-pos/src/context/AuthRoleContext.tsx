import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { hashTextSHA256 } from '../utils/helpers';

// Hash SHA-256 default untuk "admin123"
const DEFAULT_PASS_HASH = '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9';
const OWNER_IDLE_TIMEOUT_MS = 3 * 60 * 1000; // 3 menit

interface AuthRoleContextType {
  isOwnerMode: boolean;
  loginOwner: (password: string) => Promise<boolean>;
  logoutOwner: (isAuto?: boolean) => void;
  changeOwnerPassword: (newPassword: string) => Promise<void>;
}

const AuthRoleContext = createContext<AuthRoleContextType | undefined>(undefined);

export const AuthRoleProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isOwnerMode, setIsOwnerMode] = useState(false);
  const [passwordHash, setPasswordHash] = useState<string>(() => {
    return localStorage.getItem('kasir_owner_pass_hash') || DEFAULT_PASS_HASH;
  });

  const idleTimerRef = useRef<number | null>(null);

  const logoutOwner = useCallback((isAuto = false) => {
    setIsOwnerMode(false);
    if (idleTimerRef.current) {
      window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
    if (isAuto) {
      alert('Mode Owner terkunci otomatis karena tidak ada aktivitas selama 3 menit.');
    }
  }, []);

  const resetIdleTimer = useCallback(() => {
    if (!isOwnerMode) return;
    if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
    idleTimerRef.current = window.setTimeout(() => {
      logoutOwner(true);
    }, OWNER_IDLE_TIMEOUT_MS);
  }, [isOwnerMode, logoutOwner]);

  useEffect(() => {
    if (!isOwnerMode) return;
    resetIdleTimer();

    const events = ['mousemove', 'keydown', 'click'];
    events.forEach((evt) => window.addEventListener(evt, resetIdleTimer));

    return () => {
      if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
      events.forEach((evt) => window.removeEventListener(evt, resetIdleTimer));
    };
  }, [isOwnerMode, resetIdleTimer]);

  const loginOwner = async (password: string): Promise<boolean> => {
    const inputHash = await hashTextSHA256(password);
    if (inputHash === passwordHash) {
      setIsOwnerMode(true);
      return true;
    }
    return false;
  };

  const changeOwnerPassword = async (newPassword: string): Promise<void> => {
    const newHash = await hashTextSHA256(newPassword);
    setPasswordHash(newHash);
    localStorage.setItem('kasir_owner_pass_hash', newHash);
  };

  return (
    <AuthRoleContext.Provider value={{ isOwnerMode, loginOwner, logoutOwner, changeOwnerPassword }}>
      {children}
    </AuthRoleContext.Provider>
  );
};

export const useAuthRole = () => {
  const ctx = useContext(AuthRoleContext);
  if (!ctx) throw new Error('useAuthRole harus digunakan di dalam AuthRoleProvider');
  return ctx;
};