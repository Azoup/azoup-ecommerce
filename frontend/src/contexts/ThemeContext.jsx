import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { darkTheme, lightTheme } from '../constants/theme';

const ThemeContext = createContext(null);
const STORAGE_KEY = 'azoup-ecommerce-theme';

function getInitialTheme() {
  if (typeof window === 'undefined') return 'light';
  return localStorage.getItem(STORAGE_KEY) || 'light';
}

export function ThemeProvider({ children }) {
  const [isDark, setIsDark] = useState(() => getInitialTheme() === 'dark');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    localStorage.setItem(STORAGE_KEY, isDark ? 'dark' : 'light');
  }, [isDark]);

  const value = useMemo(
    () => ({
      theme: isDark ? darkTheme : lightTheme,
      isDark,
      toggleTheme: () => setIsDark((prev) => !prev),
    }),
    [isDark],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
