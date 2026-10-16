// 小票打印视图：勾选出库记录(一行一商品) -> 字段映射(名称/数量/金额) -> 小票预览(58/40/80mm 三档) -> 系统打印
// 版式与交互按原型 designs/receipt-panel-20261016/finalized.html(纸张宽度增量) 还原；计算全部在 engine/receipt.ts
// review 修复：cfg 变更实时重算（防过期金额上票）/ 折扣字符串镜像（防小数点被吞）/ 品牌图拆键持久化（防按键写放大）/ 并行读记录
// 纸张宽度(2026-10-16 客户反馈)：@page 用两长度合法写法 + beforeprint 实测内容高度——旧写法 "58mm auto"
// 不合 CSS 规范被 Chrome 丢弃、回退驱动默认，40mm 纸用户每次都要手动调驱动（XP-58 默认 58mm）
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { bitable } from '@lark-base-open/js-sdk';
import { buildReceipt, generateOrderNo, parseNumeric, paperSpecOf, ReceiptConfig, ReceiptItem, RECEIPT_PAPERS, DEFAULT_RECEIPT_PAPER_MM, RECEIPT_TEXT_TYPES, RECEIPT_NUMBER_TYPES } from '../engine/receipt';
import { getSelectedRecordIds, MAX_SELECTED_A } from '../records';
import { serializeValue } from '../engine/serialize';
import { configKey, loadConfig, saveConfig } from '../persist';

interface FieldMeta {
  id: string;
  name: string;
  type: number;
}

const MAX_BRAND_BYTES = 200 * 1024;

const labelStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 };
const inputStyle: React.CSSProperties = { width: '100%', padding: '4px 6px', border: '1px solid var(--pd-border)', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' };
const hintStyle: React.CSSProperties = { fontSize: 12, color: 'var(--pd-text-secondary)' };

/** 面板持久化形态（品牌图 dataURL 拆独立键，避免打字路径反复序列化 ~270KB） */
interface SavedReceipt {
  cfg: Omit<ReceiptConfig, 'brandImage'>;
  nameFieldId: string;
  qtyFieldId: string;
  amountFieldId: string;
  /** 纸张宽度 mm（40/58/80）；旧存档无此字段 -> 默认 58 */
  paperWidthMm?: number;
}

const DEFAULT_CFG: Omit<ReceiptConfig, 'brandImage'> = {
  storeNameEn: '',
  storeNameCn: '',
  orderNo: '',
  cashier: '',
  discountYuan: 0,
  thanks: '',
  slogan: '',
};

export default function ReceiptPrint({ baseId, tableId }: { baseId: string; tableId: string }) {
  const { t } = useTranslation();
  const [allFields, setAllFields] = useState<FieldMeta[]>([]);
  const [nameFieldId, setNameFieldId] = useState('');
  const [qtyFieldId, setQtyFieldId] = useState('');
  const [amountFieldId, setAmountFieldId] = useState('');
  /** 纸张宽度（40/58/80mm），选一次持久化，打印时按所选宽度声明 @page 尺寸 */
  const [paperWidthMm, setPaperWidthMm] = useState<number>(DEFAULT_RECEIPT_PAPER_MM);
  const [cfg, setCfg] = useState<Omit<ReceiptConfig, 'brandImage'>>({ ...DEFAULT_CFG, thanks: t('receipt.defaultThanks') });
  const [brandImage, setBrandImage] = useState<string | null>(null);
  /** 折扣输入镜像：保持原始字符串，避免 Number('12.') 抹掉小数点（10 倍错价根因） */
  const [discountStr, setDiscountStr] = useState('0');
  /** 最近一次成功执行的原始行 + 执行时刻（cfg 变更时用它重算，单号/日期保持执行时刻稳定） */
  const [lastItems, setLastItems] = useState<ReceiptItem[] | null>(null);
  const execNowRef = useRef<Date>(new Date());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const brandFileRef = useRef<HTMLInputElement>(null);
  /** 小票预览 DOM 引用：打印时实测内容高度（px→mm）+ 独立窗口/克隆兜底取 outerHTML */
  const receiptRef = useRef<HTMLDivElement>(null);

  const fullCfg: ReceiptConfig = { ...cfg, brandImage };
  /** 当前纸张规格（宽度/内容宽/字号缩放系数）；未知值回退 58mm */
  const paperSpec = paperSpecOf(paperWidthMm);
  /** 字号等比缩放：40mm 档所有字号/间距 ×0.667（36/54），58/80 为 1 */
  const px = (n: number) => `${(n * paperSpec.fontScale).toFixed(1)}px`;
  // 实时重算：cfg（含折扣）任何变化都基于最近执行的商品行重出小票，杜绝过期金额
  const data = lastItems ? buildReceipt(lastItems, fullCfg, execNowRef.current) : null;

  // 配置持久化：主键不含品牌图；品牌图独立键（上传/清除时单独写一次）
  const cfgKey = configKey(baseId, tableId, 'receipt');
  const brandKey = configKey(baseId, tableId, 'receipt-brand');
  useEffect(() => {
    const saved = loadConfig<SavedReceipt>(cfgKey);
    const savedBrand = loadConfig<string>(brandKey);
    if (saved) {
      if (saved.cfg) setCfg({ ...DEFAULT_CFG, ...saved.cfg });
      setNameFieldId(saved.nameFieldId || '');
      setQtyFieldId(saved.qtyFieldId || '');
      setAmountFieldId(saved.amountFieldId || '');
      if (saved.cfg) setDiscountStr(String(saved.cfg.discountYuan ?? 0));
      setPaperWidthMm(saved.paperWidthMm ?? DEFAULT_RECEIPT_PAPER_MM);
    }
    if (savedBrand) setBrandImage(savedBrand);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfgKey]);
  useEffect(() => {
    saveConfig(cfgKey, { cfg, nameFieldId, qtyFieldId, amountFieldId, paperWidthMm });
  }, [cfgKey, cfg, nameFieldId, qtyFieldId, amountFieldId, paperWidthMm]);

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
  const textFields = allFields.filter((f) => RECEIPT_TEXT_TYPES.includes(f.type));
  const numberFields = allFields.filter((f) => RECEIPT_NUMBER_TYPES.includes(f.type));

  const setCfgField = (patch: Partial<Omit<ReceiptConfig, 'brandImage'>>) => setCfg((c) => ({ ...c, ...patch }));

  // 折扣输入：镜像字符串自由编辑，可解析且 >=0 时才同步到 cfg（进入实时重算）
  const onDiscountChange = (raw: string) => {
    setDiscountStr(raw);
    const n = parseFloat(raw);
    if (Number.isFinite(n) && n >= 0) setCfgField({ discountYuan: n });
    if (raw.trim() === '') setCfgField({ discountYuan: 0 });
  };

  // 读选中记录 -> 并行映射 ReceiptItem -> buildReceipt（记录间并行，200 条 ~1s 内）
  const loadRecords = useCallback(async () => {
    setError('');
    setStatus('');
    setBusy(true);
    setLastItems(null);
    try {
      const sel = await getSelectedRecordIds(MAX_SELECTED_A);
      if (!sel.ok) {
        setError(sel.reason!);
        return;
      }
      if (!nameFieldId || !qtyFieldId || !amountFieldId) {
        setError(t('receipt.fieldRequired'));
        return;
      }
      const table = await bitable.base.getActiveTable();
      const nameField = await table.getField(nameFieldId);
      const qtyField = await table.getField(qtyFieldId);
      const amountField = await table.getField(amountFieldId);
      const items = await Promise.all(
        sel.recordIds.map(async (recordId): Promise<ReceiptItem> => {
          const name = await nameField
            .getValue(recordId)
            .then((raw: unknown) => {
              const ser = serializeValue('Text', raw);
              return ser.ok ? ser.text.trim() : '';
            })
            .catch(() => '');
          const qty = await qtyField
            .getValue(recordId)
            .then((raw: unknown) => parseNumeric(raw))
            .catch(() => null);
          const amount = await amountField
            .getValue(recordId)
            .then((raw: unknown) => parseNumeric(raw))
            .catch(() => null);
          return { name, qty, amount };
        }),
      );
      execNowRef.current = new Date();
      const r = buildReceipt(items, { ...cfg, brandImage }, execNowRef.current);
      if (!r.canPrint) {
        setError(t('receipt.noRenderable'));
        return;
      }
      if (r.skippedCount > 0) setStatus(t('receipt.skipped', { count: r.skippedCount }));
      setLastItems(items);
    } catch (e) {
      setError(String(e).slice(0, 150));
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nameFieldId, qtyFieldId, amountFieldId, t]);

  // 打印走独立窗口（2026-10-16 真机实测定架构）：飞书边栏 iframe 内打印时页面尺寸/边距由外层框架决定，
  // iframe 内注入的 @page 够不着（实测对话框落 Letter + 默认边距）；独立窗口是顶层文档，@page 必生效。
  // 文档只含小票 -> 同时根除 visibility 隐藏残留高度造成的空白页，页眉页脚也不带飞书页面 URL。
  // 弹窗被拦截（沙箱缺 allow-popups）时退化为原地打印（@page 注入 + beforeprint 克隆根兜底）。
  const doPrint = useCallback(() => {
    const receiptEl = receiptRef.current;
    if (!receiptEl) return;
    // 预览按真实比例渲染（96dpi, 1mm≈3.7795px），实测高度直接换算 + 4mm 上下余量
    const hMm = Math.ceil(receiptEl.offsetHeight / 3.7795) + 4;
    const w = window.open('', '_blank');
    if (!w) {
      window.print();
      return;
    }
    w.document.write(
      `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${document.title}</title>` +
        `<style>@page { size: ${paperWidthMm}mm ${hMm}mm; margin: 0; }` +
        `html, body { margin: 0; padding: 0; background: #fff; }` +
        `body { font-family: -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif; }` +
        `[data-receipt] { box-shadow: none !important; }</style></head><body>${receiptEl.outerHTML}</body></html>`,
    );
    w.document.close();
    w.onload = () => {
      w.print();
      w.addEventListener('afterprint', () => w.close()); // 打印对话框关闭后自动收起空白页
    };
  }, [paperWidthMm]);

  const onBrandFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      if (!f) return;
      if (f.size > MAX_BRAND_BYTES) {
        setError(t('receipt.brandTooLarge'));
        e.target.value = '';
        return;
      }
      const rd = new FileReader();
      rd.onload = () => {
        const dataUrl = String(rd.result);
        setBrandImage(dataUrl);
        saveConfig(brandKey, dataUrl); // 品牌图独立键，仅在上传/清除时写一次
        setError('');
      };
      rd.readAsDataURL(f);
    },
    [brandKey, t],
  );

  const clearBrand = useCallback(() => {
    setBrandImage(null);
    saveConfig(brandKey, null);
    if (brandFileRef.current) brandFileRef.current.value = '';
  }, [brandKey]);

  const newOrderNo = useCallback(() => {
    // 复用引擎单号生成器（单一真源，防止格式漂移）
    setCfgField({ orderNo: generateOrderNo() });
  }, []);

  // 挂载时注入 @page 覆盖规则（CSS 层叠后者胜，不依赖 index.html 的 style 结构）+ 打印标记；卸载移除还原 A4。
  // 宽度 = 所选纸张；beforeprint 时按内容实测高度补全两长度合法 size（宽+高均为长度的写法 Chrome 才认，
  // 会按任务覆盖驱动默认并自动匹配驱动里已有的纸张规格；高度实测 -> 卷纸连续出纸、末尾裁切不空走纸）。
  // 注：此为原地打印兜底路径的声明；主路径独立打印窗口自带 @page（iframe 内声明够不着外层框架）。
  useEffect(() => {
    const el = document.createElement('style');
    el.id = 'receipt-page-style';
    document.head.appendChild(el);
    const updatePage = () => {
      // offsetHeight px -> mm（96dpi: 1mm≈3.7795px）+ 4mm 上下余量；预览未渲染时退化为宽度声明+最小高度
      const hMm = Math.ceil((receiptRef.current?.offsetHeight ?? 0) / 3.7795) + 4;
      el.textContent = `@page { size: ${paperWidthMm}mm ${hMm}mm; margin: 0; }`;
    };
    updatePage();
    window.addEventListener('beforeprint', updatePage);
    document.body.setAttribute('data-print-receipt', '1');
    return () => {
      window.removeEventListener('beforeprint', updatePage);
      el.remove();
      document.body.removeAttribute('data-print-receipt');
    };
  }, [paperWidthMm]);

  // 原地打印兜底路径（弹窗被拦截时）：beforeprint 把小票克隆到独立根节点，配合 index.html 打印 CSS
  // 对 body 其余子树 display:none——visibility:hidden 不释放布局高度，面板表单残留高度会分页出空白页
  // （2026-10-16 真机实测 3 页中后 2 页空白，老机制遗留 bug）
  useEffect(() => {
    const onBeforePrint = () => {
      const receiptEl = receiptRef.current;
      if (!receiptEl) return;
      let root = document.getElementById('pd-print-root');
      if (!root) {
        root = document.createElement('div');
        root.id = 'pd-print-root';
        document.body.appendChild(root);
      }
      const clone = receiptEl.cloneNode(true) as HTMLElement;
      clone.style.boxShadow = 'none';
      root.replaceChildren(clone);
    };
    const onAfterPrint = () => document.getElementById('pd-print-root')?.remove();
    window.addEventListener('beforeprint', onBeforePrint);
    window.addEventListener('afterprint', onAfterPrint);
    return () => {
      window.removeEventListener('beforeprint', onBeforePrint);
      window.removeEventListener('afterprint', onAfterPrint);
      document.getElementById('pd-print-root')?.remove();
    };
  }, []);

  const onOrderNoChange = useCallback((raw: string) => {
    // 手输单号时关闭后续自动生成（非空即视为用户接管）
    setCfgField({ orderNo: raw });
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
          {t('receipt.amountField')}
          {fieldSelect(amountFieldId, setAmountFieldId, numberFields)}
        </label>
      </div>
      <div style={hintStyle}>{t('receipt.rowSemantics')}</div>

      <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--pd-text-secondary)' }}>{t('receipt.receiptInfo')}</div>
      <label style={labelStyle}>
        {t('receipt.paperWidth')}
        <select value={String(paperWidthMm)} onChange={(e) => setPaperWidthMm(Number(e.target.value))} style={inputStyle}>
          {RECEIPT_PAPERS.map((p) => (
            <option key={p.widthMm} value={String(p.widthMm)}>{t(`receipt.paper${p.widthMm}`)}</option>
          ))}
        </select>
      </label>
      <div style={hintStyle}>{t('receipt.paperHint')}</div>
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
            <input type="text" value={cfg.orderNo} placeholder={t('receipt.orderNoAuto') || ''} onChange={(e) => onOrderNoChange(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
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
          <input type="number" min={0} step={0.01} value={discountStr} onChange={(e) => onDiscountChange(e.target.value)} style={inputStyle} />
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
          {brandImage && <button type="button" onClick={clearBrand}>{t('receipt.clear')}</button>}
        </div>
      </label>

      <button disabled={busy || !nameFieldId || !qtyFieldId || !amountFieldId} onClick={loadRecords}>
        {t('common.execute')}
      </button>
      {error && <div style={{ color: 'var(--pd-error)', fontSize: 12 }}>{error}</div>}
      {status && <div style={{ fontSize: 12, color: 'var(--pd-warning, #d97706)' }}>{status}</div>}

      {data && (
        <>
          <div style={hintStyle}>{t('receipt.previewNote', { width: paperWidthMm })}</div>
          <div style={{ display: 'flex', justifyContent: 'center', background: 'var(--pd-bg)', borderRadius: 6, padding: 12 }}>
            {/* 打印区：所选纸张真实比例（1mm≈3.7795px），40mm 档字号等比微缩；打印样式见 index.html @media print */}
            <div
              ref={receiptRef}
              data-receipt
              style={{
                width: `${paperSpec.widthMm}mm`,
                padding: '2mm',
                boxSizing: 'border-box',
                background: '#fff',
                color: '#000',
                boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
                fontSize: px(11),
                lineHeight: 1.5,
              }}
            >
              {cfg.storeNameEn.trim() && (
                <div style={{ textAlign: 'center', fontSize: px(13), fontWeight: 700, letterSpacing: px(2) }}>{cfg.storeNameEn}</div>
              )}
              {cfg.storeNameCn.trim() && (
                <div style={{ textAlign: 'center', fontSize: px(17), fontWeight: 700, letterSpacing: px(4), marginBottom: px(8) }}>{cfg.storeNameCn}</div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: px(10) }}>
                <span>{t('receipt.orderNoLabel')}{data.generatedOrderNo}</span>
                <span>{t('receipt.cashierLabel')}{cfg.cashier || '—'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: px(10) }}>
                <span>{t('receipt.dateLabel')}{data.dateText}</span>
                <span>{t('receipt.timeLabel')}{data.timeText}</span>
              </div>
              <hr style={{ border: 'none', borderTop: '1px dashed #000', margin: `${px(6)} 0` }} />
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: px(11) }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: `${px(2)} 0` }}>{t('receipt.colName')}</th>
                    <th style={{ textAlign: 'center', padding: `${px(2)} 0` }}>{t('receipt.colQty')}</th>
                    <th style={{ textAlign: 'right', padding: `${px(2)} 0` }}>{t('receipt.colAmount')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.lines.map((l, i) => (
                    <tr key={i}>
                      <td style={{ padding: `${px(3)} 0`, verticalAlign: 'top', wordBreak: 'break-all' }}>{l.name}</td>
                      <td style={{ padding: `${px(3)} 0`, textAlign: 'center', fontFamily: 'monospace' }}>{l.qty}</td>
                      <td style={{ padding: `${px(3)} 0`, textAlign: 'right', fontFamily: 'monospace' }}>{l.amountText}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <hr style={{ border: 'none', borderTop: '1px dashed #000', margin: `${px(6)} 0` }} />
              <div style={{ fontSize: px(11) }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: `${px(2)} 0` }}>
                  <span>{t('receipt.totalCount')}</span>
                  <span style={{ fontFamily: 'monospace' }}>{data.totalCountText}{t('receipt.countUnit')}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: `${px(2)} 0` }}>
                  <span>{t('receipt.subtotal')}</span>
                  <span style={{ fontFamily: 'monospace' }}>{data.subtotalText}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: `${px(2)} 0` }}>
                  <span>{t('receipt.discountLabel')}</span>
                  <span style={{ fontFamily: 'monospace' }}>{data.discountText}</span>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: px(15), fontWeight: 700, padding: `${px(4)} 0` }}>
                <span>{t('receipt.payable')}</span>
                <span style={{ fontFamily: 'monospace' }}>{data.payableText}</span>
              </div>
              <hr style={{ border: 'none', borderTop: '1px dashed #000', margin: `${px(6)} 0` }} />
              {cfg.thanks.trim() && <div style={{ textAlign: 'center', fontSize: px(11), letterSpacing: px(2), margin: `${px(6)} 0` }}>{cfg.thanks}</div>}
              {brandImage && <img src={brandImage} alt="" style={{ display: 'block', margin: `${px(4)} auto`, maxWidth: `${(30 * paperSpec.fontScale).toFixed(1)}mm`, maxHeight: `${(16 * paperSpec.fontScale).toFixed(1)}mm`, objectFit: 'contain' }} />}
              {cfg.slogan.trim() && <div style={{ textAlign: 'center', fontSize: px(10), color: '#555' }}>{cfg.slogan}</div>}
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
