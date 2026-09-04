// 主题 hook（官方指南硬要求：bridge.getTheme + onThemeChange，浅深主题变量）
import { useEffect, useState } from 'react';
import { bitable } from '@lark-base-open/js-sdk';

export type Theme = 'LIGHT' | 'DARK';

const THEME_VARS: Record<Theme, Record<string, string>> = {
  LIGHT: {
    '--pd-primary': 'rgb(20, 86, 240)',
    '--pd-bg': '#ffffff',
    '--pd-bg-secondary': '#f5f6f7',
    '--pd-text': '#1f2329',
    '--pd-text-secondary': '#646a73',
    '--pd-border': '#dee0e3',
    '--pd-error': '#d83931',
    '--pd-warn-bg': '#fef4e6',
  },
  DARK: {
    '--pd-primary': '#4571e1',
    '--pd-bg': '#252525',
    '--pd-bg-secondary': '#2e2e2e',
    '--pd-text': '#e8e8e8',
    '--pd-text-secondary': '#a6a6a6',
    '--pd-border': '#434343',
    '--pd-error': '#f2635f',
    '--pd-warn-bg': '#3d3223',
  },
};

export function applyTheme(theme: Theme): void {
  const el = document.documentElement;
  Object.entries(THEME_VARS[theme]).forEach(([k, v]) => el.style.setProperty(k, v));
}

export function useTheme(): Theme {
  const [theme, setTheme] = useState<Theme>('LIGHT');
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const t = await bitable.bridge.getTheme();
        if (!mounted) return;
        const th = (String(t).toUpperCase().includes('DARK') ? 'DARK' : 'LIGHT') as Theme;
        setTheme(th);
        applyTheme(th);
      } catch {
        applyTheme('LIGHT');
      }
    })();
    try {
      bitable.bridge.onThemeChange((event: { data: { theme: string } }) => {
        const th = (String(event.data.theme).toUpperCase().includes('DARK') ? 'DARK' : 'LIGHT') as Theme;
        setTheme(th);
        applyTheme(th);
      });
    } catch {
      /* 桌面端旧版可能不支持，忽略 */
    }
    return () => {
      mounted = false;
    };
  }, []);
  return theme;
}
