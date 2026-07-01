'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  const isDark = theme === 'dark';

  return (
    <button
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      aria-label="Toggle theme"
      style={{
        border: '1px solid var(--panel-line)',
        background: 'var(--panel)',
        color: 'var(--paper-dim)',
        fontFamily: 'var(--font-jetbrains-mono), JetBrains Mono, monospace',
        fontSize: '12px',
        letterSpacing: '0.04em',
        padding: '8px 14px',
        borderRadius: '99px',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        transition: 'border-color 0.2s ease, color 0.2s ease',
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLElement).style.borderColor = 'var(--lime)';
        (e.currentTarget as HTMLElement).style.color = 'var(--paper)';
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.borderColor = 'var(--panel-line)';
        (e.currentTarget as HTMLElement).style.color = 'var(--paper-dim)';
      }}
    >
      ◐ {isDark ? 'Dark' : 'Light'}
    </button>
  );
}