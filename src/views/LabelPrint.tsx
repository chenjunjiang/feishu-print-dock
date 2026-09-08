// A 标签排版打印视图：选中记录 -> A4 网格排版 -> 打印 / jsPDF 下载 / 写回附件
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { bitable } from '@lark-base-open/js-sdk';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import {
  A4_W_MM,
  A4_H_MM,
  HTML2CANVAS_SCALE,
  GridSpec,
  computeGrid,
  validateGrid,
  cellSizeMm,
  isCellTooNarrow,
  LABEL_PRESETS,
  mmToPx,
} from '../engine/grid';
import { getSelectedRecordIds, makeAttachmentUrlCache, fetchImageBlob, MAX_SELECTED_A, safeFileName, recordTitleOf, partitionRenderable } from '../records';
import { writeBackBatch, AttachmentFieldLike } from '../writeback';
import { serializeValue, FieldTypeName } from '../engine/serialize';
import { configKey, loadConfig, saveConfig } from '../persist';

interface FieldMeta {
  id: string;
  name: string;
  type: number;
}

interface LabelItem {
  recordId: string;
  title: string;
  imgUrl: string | null;
}

const PAGE_PX_W = mmToPx(A4_W_MM);
const PAGE_PX_H = mmToPx(A4_H_MM);
const MAX_PDF_BYTES = 50 * 1024 * 1024;

export default function LabelPrint({ baseId, tableId }: { baseId: string; tableId: string }) {
  const { t } = useTranslation();
  const [attachmentFields, setAttachmentFields] = useState<FieldMeta[]>([]);
  const [textFields, setTextFields] = useState<FieldMeta[]>([]);
  const [imgFieldId, setImgFieldId] = useState('');
  const [titleFieldId, setTitleFieldId] = useState('');
  const [spec, setSpec] = useState<GridSpec>({ rows: 4, cols: 4, marginMm: 10, gapMm: 2 });
  const [border, setBorder] = useState(true);
  const [items, setItems] = useState<LabelItem[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [writeBackStatus, setWriteBackStatus] = useState('');
  const printRef = useRef<HTMLDivElement>(null);

  // 配置持久化（baseId+tableId 键空间）
  const cfgKey = configKey(baseId, tableId, 'label');
  useEffect(() => {
    const saved = loadConfig<{ spec: GridSpec; border: boolean; imgFieldId: string; titleFieldId: string }>(cfgKey);
    if (saved) {
      setSpec(saved.spec);
      setBorder(saved.border);
      setImgFieldId(saved.imgFieldId);
      setTitleFieldId(saved.titleFieldId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfgKey]);
  useEffect(() => {
    saveConfig(cfgKey, { spec, border, imgFieldId, titleFieldId });
  }, [cfgKey, spec, border, imgFieldId, titleFieldId]);

  // 字段清单（变化监听：切表后重载）
  useEffect(() => {
    (async () => {
      try {
        const table = await bitable.base.getActiveTable();
        const metas = await table.getFieldMetaList();
        setAttachmentFields(metas.filter((f) => f.type === 17).map((f) => ({ id: f.id, name: f.name, type: f.type })));
        setTextFields(
          metas
            .filter((f) => [1, 2, 3, 5, 7, 15, 1005].includes(f.type))
            .map((f) => ({ id: f.id, name: f.name, type: f.type })),
        );
      } catch (e) {
        setError(String(e).slice(0, 150));
      }
    })();
  }, [baseId, tableId]);

  const gridError = validateGrid(spec);

  const loadRecords = useCallback(async () => {
    setError('');
    setBusy(true);
    setItems(null);
    try {
      const sel = await getSelectedRecordIds(MAX_SELECTED_A);
      if (!sel.ok) {
        setError(sel.reason!);
        return;
      }
      if (!imgFieldId) {
        setError(t('label.imageField') + ' ?');
        return;
      }
      const table = await bitable.base.getActiveTable();
      const imgField = await table.getField(imgFieldId);
      const urlCache = makeAttachmentUrlCache();
      const out: LabelItem[] = [];
      let titleField: { getValue(recordOrId: string): Promise<unknown>; type?: number } | null = null;
      if (titleFieldId) {
        titleField = (await table.getField(titleFieldId)) as unknown as { getValue(recordOrId: string): Promise<unknown>; type?: number };
      }
      for (const recordId of sel.recordIds) {
        // 标题：选了标题字段但值为空 -> 留空（不显示 recordId 乱码短码）；未选字段也不显示
        let title = '';
        if (titleField) {
          try {
            const raw = await titleField.getValue(recordId);
            const typeName = 'Text' as FieldTypeName; // 白名单类型在序列化层判定
            const ser = serializeValue(typeName, raw);
            if (ser.ok && ser.text.trim()) title = ser.text.trim();
          } catch {
            /* 标题读取失败留空 */
          }
        }
        const imgUrl = await urlCache.get(recordId, imgField);
        out.push({ recordId, title, imgUrl });
      }
      urlCache.revokeAll();
      // 无图记录不进排版（避免打出 "no image" 空白标签），跳过数量显式提示
      const { ok: renderable, skipped } = partitionRenderable(out);
      if (renderable.length === 0) {
        setError(t('label.noRenderable'));
        setItems(null);
        return;
      }
      if (skipped.length > 0) setWriteBackStatus(t('label.skippedNoImage', { count: skipped.length }));
      setItems(renderable);
    } catch (e) {
      setError(String(e).slice(0, 150));
    } finally {
      setBusy(false);
    }
  }, [imgFieldId, titleFieldId, t]);

  const layout = useMemo(() => (items ? computeGrid(spec, items.length) : null), [items, spec]);

  const doPrint = useCallback(() => {
    window.print();
  }, []);

  const doDownloadPdf = useCallback(async () => {
    if (!printRef.current || !items) return;
    setBusy(true);
    setError('');
    try {
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pages = printRef.current.querySelectorAll<HTMLElement>('[data-page]');
      let total = 0;
      for (let i = 0; i < pages.length; i++) {
        // useCORS: true 必填——附件 tmp URL 跨域（实测 ACAO:*），默认 false 时 html2canvas 静默丢图
        const canvas = await html2canvas(pages[i], { scale: HTML2CANVAS_SCALE, backgroundColor: '#ffffff', useCORS: true });
        const img = canvas.toDataURL('image/jpeg', 0.85);
        if (i > 0) pdf.addPage('a4', 'portrait');
        pdf.addImage(img, 'JPEG', 0, 0, A4_W_MM, A4_H_MM);
        total += img.length;
        if (total > MAX_PDF_BYTES) {
          setError('PDF 超过 50MB 上限，请分批处理');
          return;
        }
      }
      pdf.save('labels.pdf');
    } catch (e) {
      setError(String(e).slice(0, 150));
    } finally {
      setBusy(false);
    }
  }, [items]);

  const doWriteBack = useCallback(async () => {
    if (!items || !printRef.current) return;
    setBusy(true);
    setWriteBackStatus('');
    try {
      const table = await bitable.base.getActiveTable();
      const field = (await table.getField(imgFieldId)) as unknown as AttachmentFieldLike;
      const cells = printRef.current.querySelectorAll<HTMLElement>('[data-cell-record]');
      const wbItems = [];
      for (const cell of Array.from(cells)) {
        const recordId = cell.dataset.cellRecord!;
        const canvas = await html2canvas(cell, { scale: HTML2CANVAS_SCALE, backgroundColor: '#ffffff', useCORS: true });
        const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
        if (!blob) continue;
        const item = items.find((it) => it.recordId === recordId)!;
        wbItems.push({ recordId, files: [{ name: safeFileName(item.title, 'label', 'png'), blob }] });
      }
      const r = await writeBackBatch(field, wbItems, {
        onProgress: (p) => setWriteBackStatus(`${t('writeback.progress')}: ${p.done}/${p.total}`),
      });
      setWriteBackStatus(
        r.ok
          ? `${t('writeback.done')} (${r.succeeded.length})`
          : `${t('writeback.failed')}: ${r.failed.map((f) => f.recordId.slice(-4)).join(', ')}`,
      );
    } catch (e) {
      setWriteBackStatus(String(e).slice(0, 150));
    } finally {
      setBusy(false);
    }
  }, [items, imgFieldId, t]);

  const numberInput = (label: string, key: keyof GridSpec, min: number, max: number) => (
    <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '6px 0' }}>
      <span>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={spec[key]}
        onChange={(e) => setSpec({ ...spec, [key]: Number(e.target.value) })}
        style={{ width: 64 }}
      />
    </label>
  );

  // 排版区：预设匹配（当前行列数等于某预设则高亮该预设，否则"自定义"）
  const presetMatch = LABEL_PRESETS.findIndex((p) => p.rows === spec.rows && p.cols === spec.cols);
  const cell = cellSizeMm(spec);
  const tooNarrow = isCellTooNarrow(spec);
  const gridInput = (key: 'rows' | 'cols') => (
    <input
      type="number"
      min={1}
      max={20}
      value={spec[key]}
      onChange={(e) => setSpec({ ...spec, [key]: Number(e.target.value) })}
      style={{ width: 56 }}
    />
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 8 }}>
      <label>
        {t('label.imageField')}
        <select value={imgFieldId} onChange={(e) => setImgFieldId(e.target.value)} style={{ width: '100%' }}>
          <option value="">--</option>
          {attachmentFields.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
      </label>
      <label>
        {t('label.titleField')}
        <select value={titleFieldId} onChange={(e) => setTitleFieldId(e.target.value)} style={{ width: '100%' }}>
          <option value="">--</option>
          {textFields.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
      </label>
      <div style={{ fontSize: 12, color: 'var(--pd-text-secondary)' }}>{t('label.multiAttachment')}</div>
      {/* 标签纸预设：用户心智是"买的 N 格标签纸"，选预设自动填行列数 */}
      <label>
        {t('label.preset')}
        <select
          value={presetMatch}
          onChange={(e) => {
            const i = Number(e.target.value);
            if (i >= 0) setSpec({ ...spec, rows: LABEL_PRESETS[i].rows, cols: LABEL_PRESETS[i].cols });
          }}
          style={{ width: '100%' }}
        >
          <option value={-1}>{t('label.presetCustom')}</option>
          {LABEL_PRESETS.map((p, i) => (
            <option key={i} value={i}>{`${p.rows}×${p.cols}（${p.rows * p.cols}${t('label.perSheet')}）`}</option>
          ))}
        </select>
      </label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '6px 0' }}>
        <span>{t('label.layout')}</span>
        {gridInput('rows')} × {gridInput('cols')}
      </div>
      {/* 实时反馈：每页张数 + 单格实际尺寸；过窄时警告条码可能扫不出 */}
      <div style={{ fontSize: 12, color: 'var(--pd-text-secondary)' }}>
        {`= ${spec.rows * spec.cols}${t('label.perSheet')}，${t('label.cellSize')} ${cell.w.toFixed(1)} × ${cell.h.toFixed(1)} mm`}
      </div>
      {tooNarrow && (
        <div style={{ fontSize: 12, color: 'var(--pd-warning, #d97706)' }}>{t('label.tooNarrow')}</div>
      )}
      {numberInput(t('label.margin'), 'marginMm', 0, 30)}
      {numberInput(t('label.gap'), 'gapMm', 0, 20)}
      <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input type="checkbox" checked={border} onChange={(e) => setBorder(e.target.checked)} />
        {t('label.border')}
      </label>
      {gridError && <div style={{ color: 'var(--pd-error)' }}>{gridError}</div>}
      <button disabled={busy || !!gridError || !imgFieldId} onClick={loadRecords}>
        {t('common.execute')}
      </button>
      {error && <div style={{ color: 'var(--pd-error)' }}>{error}</div>}

      {items && layout && (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={doPrint} disabled={busy}>{t('common.print')}</button>
            <button onClick={doDownloadPdf} disabled={busy}>{t('common.downloadPdf')}</button>
            <button onClick={doWriteBack} disabled={busy}>{t('common.writeBack')}</button>
          </div>
          <div style={{ fontSize: 12, color: 'var(--pd-text-secondary)' }}>{t('label.pdfNote')}</div>
          {writeBackStatus && <div>{writeBackStatus}</div>}
          <div ref={printRef} className="print-area">
            {Array.from({ length: layout.pageCount }, (_, page) => (
              <div
                key={page}
                data-page={page}
                className="print-page"
                style={{
                  position: 'relative',
                  width: PAGE_PX_W,
                  height: PAGE_PX_H,
                  background: '#fff',
                  pageBreakAfter: 'always',
                  overflow: 'hidden',
                  margin: '8px 0',
                  boxShadow: '0 0 4px rgba(0,0,0,0.2)',
                }}
              >
                {layout.cells
                  .filter((c) => c.page === page)
                  .map((c, idx) => {
                    const item = items[page * spec.rows * spec.cols + idx];
                    if (!item) return null;
                    return (
                      <div
                        key={`${page}-${idx}`}
                        data-cell-record={item.recordId}
                        style={{
                          position: 'absolute',
                          left: mmToPx(c.x),
                          top: mmToPx(c.y),
                          width: mmToPx(c.w),
                          height: mmToPx(c.h),
                          border: border ? '0.3mm dashed #999' : 'none',
                          boxSizing: 'border-box',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          overflow: 'hidden',
                          background: '#fff',
                        }}
                      >
                        {item.imgUrl ? (
                          <img
                            src={item.imgUrl}
                            alt=""
                            style={{ maxWidth: '90%', maxHeight: '75%', objectFit: 'contain' }}
                            crossOrigin="anonymous"
                          />
                        ) : (
                          <div style={{ color: '#999', fontSize: 10 }}>no image</div>
                        )}
                        {item.title && (
                          <div style={{ fontSize: mmToPx(3), color: '#000', marginTop: 2, textAlign: 'center' }}>
                            {item.title}
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
