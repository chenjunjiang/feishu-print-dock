// 入口：主题 + i18n + 存储健康横幅 + Tab（无路由，状态切换——hash 路由契约对单页适用默认）
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useTranslation } from 'react-i18next';
import { bitable } from '@lark-base-open/js-sdk';
import { useTheme } from './theme';
import { initI18n } from './i18n';
import { detectStorageHealth, StorageHealth } from './persist';
import LabelPrint from './views/LabelPrint';
import WordMerge from './views/WordMerge';

initI18n('zh');

function App() {
  const { t } = useTranslation();
  useTheme();
  const [tab, setTab] = useState<'label' | 'merge'>('label');
  const [baseId, setBaseId] = useState('');
  const [tableId, setTableId] = useState('');
  const [storageHealth, setStorageHealth] = useState<StorageHealth>('ok');

  useEffect(() => {
    setStorageHealth(detectStorageHealth());
    (async () => {
      try {
        const sel = await bitable.base.getSelection();
        if (sel.baseId) setBaseId(sel.baseId);
        if (sel.tableId) setTableId(sel.tableId);
      } catch {
        /* 初始化无法获取数据结构时保持空，视图内各功能有显式提示 */
      }
    })();
  }, []);

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: '6px 12px',
    border: 'none',
    borderBottom: active ? '2px solid var(--pd-primary)' : '2px solid transparent',
    background: 'none',
    color: active ? 'var(--pd-primary)' : 'var(--pd-text-secondary)',
    cursor: 'pointer',
    fontWeight: active ? 600 : 400,
  });

  return (
    <div style={{ background: 'var(--pd-bg)', color: 'var(--pd-text)', minHeight: '100vh', fontSize: 13 }}>
      {storageHealth === 'degraded' && (
        <div style={{ background: 'var(--pd-warn-bg)', padding: '6px 10px', fontSize: 12 }}>
          {t('common.storageDegraded')}
        </div>
      )}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--pd-border)' }}>
        <button style={tabStyle(tab === 'label')} onClick={() => setTab('label')}>
          {t('tab.label')}
        </button>
        <button style={tabStyle(tab === 'merge')} onClick={() => setTab('merge')}>
          {t('tab.merge')}
        </button>
      </div>
      {tab === 'label' ? (
        <LabelPrint baseId={baseId || 'unknown'} tableId={tableId || 'unknown'} />
      ) : (
        <WordMerge baseId={baseId || 'unknown'} tableId={tableId || 'unknown'} />
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
