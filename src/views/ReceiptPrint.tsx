// 小票打印视图：勾选出库记录(一行一商品) -> 字段映射(名称/数量/单价) -> 58mm 小票预览 -> 系统打印
// 版式与交互按原型 designs/receipt-panel-20261009/finalized.html 还原；计算全部在 engine/receipt.ts
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { bitable } from '@lark-base-open/js-sdk';
import { buildReceipt, ReceiptConfig, ReceiptItem, RECEIPT_PAPER_MM, RECEIPT_CONTENT_MM } from '../engine/receipt';
import { getSelectedRecordIds, MAX_SELECTED_A } from '../records';
import { serializeValue } from '../engine/serialize';
import { configKey, loadConfig, saveConfig } from '../persist';

interface FieldMeta {
  id: string;
  name: string;
  type: number;
}

/** 字段类型白名单：名称=文本类，数量/单价=数字 */
const TEXT_TYPES = [1, 2, 3, 5, 7, 15, 1005];
const NUMBER_TYPES = [2];

const MAX_BRAND_BYTES = 200 * 1024;

const labelStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 };
const inputStyle: React.CSSProperties = { width: '100%', padding: '4px 6px', border: '1px solid var(--pd-border)', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' };
const hintStyle: React.CSSProperties = { fontSize: 12, color: 'var(--pd-text-secondary)' };
const dashStyle: React.CSSProperties = { border: 'none', borderTop: '1px dashed #000', margin: '6px 0' };

export default function ReceiptPrint({ baseId, tableId }: { baseId: string; tableId: string }) {
  const { t } = useTranslation();
  const [allFields, setAllFields] = useState<FieldMeta[]>([]);
  const [nameFieldId, setNameFieldId] = useState('');
  const [qtyFieldId, setQtyFieldId] = useState('');
  const [priceFieldId, setPriceFieldId] = useState('');
  const [cfg, setCfg] = useState<ReceiptConfig>({
    storeNameEn: '',
    storeNameCn: '',
    orderNo: '',
    cashier: '',
    discountYuan: 0,
    thanks: t('receipt.defaultThanks'),
    slogan: '',
    brandImage: null,
  });
  const [data, setData] = useState<ReturnType<typeof buildReceipt> | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const printRef = useRef<HTMLDivElement>(null);
  const brandFileRef = useRef<HTMLInputElement>(null);

  // 配置持久化（purpose='receipt'，含字段映射+面板配置+品牌图）
  const cfgKey = configKey(baseId, tableId, 'receipt');
  useEffect(() => {
    const saved = loadConfig<{ cfg: ReceiptConfig; nameFieldId: string; qtyFieldId: string; priceFieldId: string }>(cfgKey);
    if (saved) {
      if (saved.cfg) setCfg({ ...saved.cfg });
      setNameFieldId(saved.nameFieldId || '');
      setQtyFieldId(saved.qtyFieldId || '');
      setPriceFieldId(saved.priceFieldId || '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfgKey]);
  useEffect(() => {
    saveConfig(cfgKey, { cfg, nameFieldId, qtyFieldId, priceFieldId });
  }, [cfgKey, cfg, nameFieldId, qtyFieldId, priceFieldId]);

  // 字段清单：名称下拉=文本类，数量/单价下拉=数字
  useEffect(() => {
    (async () => {
      try {
        const table = await bitable.base.getActiveTable();
        const metas = await table.getFieldMetaList();
        setAllFields(metas.map((f) => ({ id: f.id, name: f.name, type: f.type })));
      } catch (e) {
        setError(String(e).slice(0, 150));
      }
    })();
  }, [baseId, tableId]);
  const textFields = allFields.filter((f) => TEXT_TYPES.includes(f.type));
  const numberFields = allFields.filter((f) => NUMBER_TYPES.includes(f.type));

  const setCfgField = (patch: Partial<ReceiptConfig>) => setCfg((c) => ({ ...c, ...patch }));

  // 读选中记录 -> 映射 ReceiptItem -> buildReceipt
  const loadRecords = useCallback(async () => {
    setError('');
    setStatus('');
    setBusy(true);
    try {
      const sel = await getSelectedRecordIds(MAX_SELECTED_A);
      if (!sel.ok) {
        setError(sel.reason!);
        return;
      }
      if (!nameFieldId || !qtyFieldId || !priceFieldId) {
        setError(t('receipt.fieldRequired'));
        return;
      }
      const table = await bitable.base.getActiveTable();
      const nameField = await table.getField(nameFieldId);
      const qtyField = await table.getField(qtyFieldId);
      const priceField = await table.getField(priceFieldId);
      const items: ReceiptItem[] = [];
      for (const recordId of sel.recordIds) {
        const name = await (async (): Promise<string> => {
          try {
            const raw = await nameField.getValue(recordId);
            const ser = serializeValue('Text', raw);
            return ser.ok ? ser.text.trim() : '';
          } catch {
            return '';
          }
        })();
        // 数字字段原始值就是 number；容错经序列化层
        let qty: number | null = null;
        try {
          const raw = await qtyField.getValue(recordId);
          qty = typeof raw === 'number' ? raw : null;
        } catch { qty = null; }
        let price: number | null = null;
        try {
          const raw = await priceField.getValue(recordId);
          price = typeof raw === 'number' ? raw : null;
        } catch { price = null; }
        items.push({ name, qty: qty as number, price });
      }
      const r = buildReceipt(items, cfg);
      if (!r.canPrint) {
        setError(t('receipt.noRenderable'));
        setData(null);
        return;
      }
      if (r.skippedCount > 0) setStatus(t('receipt.skipped', { count: r.skippedCount }));
      setData(r);
    } catch (e) {
      setError(String(e).slice(0, 150));
    } finally {
      setBusy(false);
    }
  }, [nameFieldId, qtyFieldId, priceFieldId, cfg, t]);

  const doPrint = useCallback(() => window.print(), []);

  const onBrandFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > MAX_BRAND_BYTES) {
      setError(t('receipt.brandTooLarge'));
      e.target.value = '';
      return;
    }
    const rd = new FileReader();
    rd.onload = () => {
      setCfgField({ brandImage: String(rd.result) });
      setError('');
    };
    rd.readAsDataURL(f);
  }, [t]);

  const clearBrand = useCallback(() => {
    setCfgField({ brandImage: null });
    if (brandFileRef.current) brandFileRef.current.value = '';
  }, []);

  const newOrderNo = useCallback(() => {
    const p = (n: number) => String(n).padStart(2, '0');
    const d = new Date();
    setCfgField({
      orderNo: `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`,
    });
  }, []);

  // 挂载时追加 @page 58mm 覆盖规则（CSS 层叠后者胜，不依赖 index.html 的 style 结构）+ 打印标记；卸载移除还原 A4
  useEffect(() => {
    const el = document.createElement('style');
    el.id = 'receipt-page-style';
    el.textContent = '@page { size: 58mm auto; margin: 0; }';
    document.head.appendChild(el);
    document.body.setAttribute('data-print-receipt', '1');
    return () => {
      el.remove();
      document.body.removeAttribute('data-print-receipt');
    };
  }, []);

  const fieldSelect = (value: string, onChange: (v: string) => void, fields: FieldMeta[]) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={inputStyle}>
      <option value="">--</option>
      {fields.map((f) => (
        <option key={f.id} value={f.id}>{f.name}</option>
      ))}
    </select>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 8 }}>
      <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--pd-text-secondary)' }}>{t('receipt.fieldMapping')}</div>
      <label style={labelStyle}>
        {t('receipt.nameField')}
        {fieldSelect(nameFieldId, setNameFieldId, textFields)}
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <label style={labelStyle}>
          {t('receipt.qtyField')}
          {fieldSelect(qtyFieldId, setQtyFieldId, numberFields)}
        </label>
        <label style={labelStyle}>
          {t('receipt.priceField')}
          {fieldSelect(priceFieldId, setPriceFieldId, numberFields)}
        </label>
      </div>
      <div style={hintStyle}>{t('receipt.rowSemantics')}</div>

      <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--pd-text-secondary)' }}>{t('receipt.receiptInfo')}</div>
      <label style={labelStyle}>
        {t('receipt.storeEn')}
        <input type="text" value={cfg.storeNameEn} onChange={(e) => setCfgField({ storeNameEn: e.target.value })} style={inputStyle} />
      </label>
      <label style={labelStyle}>
        {t('receipt.storeCn')}
        <input type="text" value={cfg.storeNameCn} onChange={(e) => setCfgField({ storeNameCn: e.target.value })} style={inputStyle} />
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <label style={labelStyle}>
          {t('receipt.orderNo')}
          <div style={{ display: 'flex', gap: 4 }}>
            <input type="text" value={cfg.orderNo} placeholder={t('receipt.orderNoAuto') || ''} onChange={(e) => setCfgField({ orderNo: e.target.value })} style={{ ...inputStyle, flex: 1 }} />
            <button type="button" onClick={newOrderNo} style={{ flex: 'none' }}>{t('receipt.newOrderNo')}</button>
          </div>
        </label>
        <label style={labelStyle}>
          {t('receipt.cashier')}
          <input type="text" value={cfg.cashier} onChange={(e) => setCfgField({ cashier: e.target.value })} style={inputStyle} />
        </label>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <label style={labelStyle}>
          {t('receipt.discount')}
          <input type="number" min={0} step={0.01} value={cfg.discountYuan} onChange={(e) => setCfgField({ discountYuan: Number(e.target.value) })} style={inputStyle} />
        </label>
        <label style={labelStyle}>
          {t('receipt.thanks')}
          <input type="text" value={cfg.thanks} onChange={(e) => setCfgField({ thanks: e.target.value })} style={inputStyle} />
        </label>
      </div>
      <label style={labelStyle}>
        {t('receipt.slogan')}
        <input type="text" value={cfg.slogan} onChange={(e) => setCfgField({ slogan: e.target.value })} style={inputStyle} />
      </label>
      <label style={labelStyle}>
        {t('receipt.brandImage')}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="file" accept="image/png,image/jpeg" ref={brandFileRef} onChange={onBrandFile} style={{ fontSize: 12 }} />
          {cfg.brandImage && <button type="button" onClick={clearBrand}>{t('receipt.clear')}</button>}
        </div>
      </label>

      <button disabled={busy || !nameFieldId || !qtyFieldId || !priceFieldId} onClick={loadRecords}>
        {t('common.execute')}
      </button>
      {error && <div style={{ color: 'var(--pd-error)', fontSize: 12 }}>{error}</div>}
      {status && <div style={{ fontSize: 12, color: 'var(--pd-warning, #d97706)' }}>{status}</div>}

      {data && (
        <>
          <div style={hintStyle}>{t('receipt.previewNote')}</div>
          <div style={{ display: 'flex', justifyContent: 'center', background: 'var(--pd-bg)', borderRadius: 6, padding: 12 }}>
            {/* 打印区：58mm 真实比例（1mm≈3.7795px）；打印样式见 index.html @media print */}
            <div
              ref={printRef}
              data-receipt
              style={{
                width: `${RECEIPT_PAPER_MM}mm`,
                padding: '2mm',
                boxSizing: 'border-box',
                background: '#fff',
                color: '#000',
                boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
                fontSize: '11px',
                lineHeight: 1.5,
              }}
            >
              {cfg.storeNameEn.trim() && (
                <div style={{ textAlign: 'center', fontSize: 13, fontWeight: 700, letterSpacing: 2 }}>{cfg.storeNameEn}</div>
              )}
              {cfg.storeNameCn.trim() && (
                <div style={{ textAlign: 'center', fontSize: 17, fontWeight: 700, letterSpacing: 4, marginBottom: 8 }}>{cfg.storeNameCn}</div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10 }}>
                <span>{t('receipt.orderNoLabel')}{data.generatedOrderNo}</span>
                <span>{t('receipt.cashierLabel')}{cfg.cashier || '—'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10 }}>
                <span>{t('receipt.dateLabel')}{data.dateText}</span>
                <span>{t('receipt.timeLabel')}{data.timeText}</span>
              </div>
              <hr style={dashStyle} />
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '2px 0' }}>{t('receipt.colName')}</th>
                    <th style={{ textAlign: 'center', padding: '2px 0' }}>{t('receipt.colQty')}</th>
                    <th style={{ textAlign: 'right', padding: '2px 0' }}>{t('receipt.colAmount')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.lines.map((l, i) => (
                    <tr key={i}>
                      <td style={{ padding: '3px 0', verticalAlign: 'top', wordBreak: 'break-all' }}>{l.name}</td>
                      <td style={{ padding: '3px 0', textAlign: 'center', fontFamily: 'monospace' }}>{l.qty}</td>
                      <td style={{ padding: '3px 0', textAlign: 'right', fontFamily: 'monospace' }}>{l.amountText}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <hr style={dashStyle} />
              <div style={{ fontSize: 11 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                  <span>{t('receipt.totalCount')}</span>
                  <span style={{ fontFamily: 'monospace' }}>{data.totalCount}{t('receipt.countUnit')}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                  <span>{t('receipt.subtotal')}</span>
                  <span style={{ fontFamily: 'monospace' }}>{data.subtotalText}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                  <span>{t('receipt.discountLabel')}</span>
                  <span style={{ fontFamily: 'monospace' }}>{data.discountText}</span>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, fontWeight: 700, padding: '4px 0' }}>
                <span>{t('receipt.payable')}</span>
                <span style={{ fontFamily: 'monospace' }}>{data.payableText}</span>
              </div>
              <hr style={dashStyle} />
              {cfg.thanks.trim() && <div style={{ textAlign: 'center', fontSize: 11, letterSpacing: 2, margin: '6px 0' }}>{cfg.thanks}</div>}
              {cfg.brandImage && <img src={cfg.brandImage} alt="" style={{ display: 'block', margin: '4px auto', maxWidth: '30mm', maxHeight: '16mm', objectFit: 'contain' }} />}
              {cfg.slogan.trim() && <div style={{ textAlign: 'center', fontSize: 10, color: '#555' }}>{cfg.slogan}</div>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={doPrint} disabled={busy || !data.canPrint} style={{ flex: 1 }}>{t('common.print')}</button>
          </div>
          <div style={hintStyle}>{t('receipt.printNote')}</div>
        </>
      )}
    </div>
  );
}
