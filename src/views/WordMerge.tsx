// B Word 模板套打视图：上传 docx -> 占位映射 -> 批量填充 zip / 单条预览打印 / 写回附件
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { bitable } from '@lark-base-open/js-sdk';
import PizZip from 'pizzip';
import { renderAsync } from 'docx-preview';
import html2canvas from 'html2canvas';
import { extractTags, fillTemplate } from '../engine/template';
import { serializeValue, FieldTypeName, SERIALIZABLE_TYPES } from '../engine/serialize';
import { getSelectedRecordIds, MAX_BATCH_B, MAX_BATCH_C, safeFileName, recordTitleOf } from '../records';
import { writeBackBatch, AttachmentFieldLike } from '../writeback';
import { configKey, loadConfig, saveConfig, contentHash, saveTemplate, loadTemplate } from '../persist';

interface FieldMeta {
  id: string;
  name: string;
  type: number;
}

/** 字段 type 数值 -> 白名单类型名（js-sdk FieldType 枚举对齐） */
const TYPE_MAP: Record<number, FieldTypeName> = {
  1: 'Text',
  2: 'Number',
  3: 'SingleSelect',
  5: 'DateTime',
  7: 'Checkbox',
  15: 'Url',
  1005: 'AutoNumber',
};

const MAX_TEMPLATE_BYTES = 10 * 1024 * 1024;
const MAX_ZIP_BYTES = 200 * 1024 * 1024;

export default function WordMerge({ baseId, tableId }: { baseId: string; tableId: string }) {
  const { t } = useTranslation();
  const [template, setTemplate] = useState<{ name: string; data: Uint8Array; hash: string } | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [fields, setFields] = useState<FieldMeta[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [templateRestored, setTemplateRestored] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);

  // 字段清单
  useEffect(() => {
    (async () => {
      try {
        const table = await bitable.base.getActiveTable();
        const metas = await table.getFieldMetaList();
        setFields(metas.map((f) => ({ id: f.id, name: f.name, type: f.type })));
      } catch (e) {
        setError(String(e).slice(0, 150));
      }
    })();
  }, [baseId, tableId]);

  // 启动时恢复 IndexedDB 模板（键 = 持久化保存的 hash）
  useEffect(() => {
    (async () => {
      const key = configKey(baseId, tableId, 'merge', 'currentTemplate');
      const hash = loadConfig<string>(key);
      if (!hash) return;
      const stored = await loadTemplate(hash);
      if (!stored) return;
      const data = stored.data instanceof Uint8Array ? stored.data : new Uint8Array(stored.data);
      const r = extractTags(data);
      if (!r.ok) return;
      setTemplate({ name: stored.name, data, hash });
      setTags(r.tags);
      setTemplateRestored(true);
    })();
  }, [baseId, tableId]);

  const onUpload = useCallback(
    async (file: File) => {
      setError('');
      setTemplateRestored(false);
      if (file.size > MAX_TEMPLATE_BYTES) {
        setError('模板超过 10MB 上限');
        return;
      }
      const data = new Uint8Array(await file.arrayBuffer());
      const r = extractTags(data);
      if (!r.ok) {
        setError(r.reason!);
        return;
      }
      const hash = contentHash(data);
      setTemplate({ name: file.name, data, hash });
      setTags(r.tags);
      await saveTemplate(hash, file.name, data);
      saveConfig(configKey(baseId, tableId, 'merge', 'currentTemplate'), hash);
    },
    [baseId, tableId],
  );

  /** 占位 -> 字段名映射有效性（占位名即字段名；缺失红色标注 + 执行禁用） */
  const missingTags = tags.filter((tag) => !fields.some((f) => f.name === tag));

  const fillForRecords = useCallback(
    async (onlyFirst = false) => {
      if (!template) return null;
      const sel = await getSelectedRecordIds(MAX_BATCH_B);
      if (!sel.ok) {
        setError(sel.reason!);
        return null;
      }
      const table = await bitable.base.getActiveTable();
      const out: { recordId: string; title: string; docx: Uint8Array }[] = [];
      const ids = onlyFirst ? sel.recordIds.slice(0, 1) : sel.recordIds;
      for (const recordId of ids) {
        const values: Record<string, string> = {};
        let primaryTitle = recordId.slice(-6);
        for (const tag of tags) {
          const meta = fields.find((f) => f.name === tag);
          if (!meta) continue;
          try {
            const field = await table.getField(meta.id);
            const raw = await (field as unknown as { getValue(recordOrId: string): Promise<unknown> }).getValue(recordId);
            const typeName = TYPE_MAP[meta.type];
            if (typeName && SERIALIZABLE_TYPES.includes(typeName)) {
              const ser = serializeValue(typeName, raw);
              values[tag] = ser.ok ? ser.text : '';
            } else {
              values[tag] = ''; // 不支持类型显式空（UI 已标注）
            }
            if (primaryTitle === recordId.slice(-6)) primaryTitle = recordTitleOf(recordId, raw);
          } catch {
            values[tag] = '';
          }
        }
        out.push({ recordId, title: primaryTitle, docx: fillTemplate(template.data, values) });
      }
      return out;
    },
    [template, tags, fields],
  );

  const doDownloadZip = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const filled = await fillForRecords();
      if (!filled) return;
      const zip = new PizZip();
      const usedNames = new Map<string, number>();
      let total = 0;
      for (const f of filled) {
        let name = safeFileName(f.title, '套打', 'docx');
        const n = usedNames.get(name) ?? 0;
        usedNames.set(name, n + 1);
        if (n > 0) name = name.replace('.docx', `(${n + 1}).docx`);
        total += f.docx.length;
        if (total > MAX_ZIP_BYTES) {
          setError('输出超过 200MB 上限，请分批处理');
          return;
        }
        zip.file(name, f.docx);
      }
      const blob = zip.generate({ type: 'blob', compression: 'DEFLATE' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = '套打.zip';
      a.click();
      URL.revokeObjectURL(a.href);
    } finally {
      setBusy(false);
    }
  }, [fillForRecords]);

  const doPreview = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const filled = await fillForRecords(true);
      if (!filled || filled.length === 0 || !previewRef.current) return;
      previewRef.current.innerHTML = '';
      await renderAsync(filled[0].docx.buffer as ArrayBuffer, previewRef.current);
    } catch (e) {
      setError(String(e).slice(0, 150));
    } finally {
      setBusy(false);
    }
  }, [fillForRecords]);

  const doPrint = useCallback(() => {
    window.print();
  }, []);

  const doWriteBack = useCallback(async () => {
    if (!previewRef.current || !template) return;
    setBusy(true);
    setStatus('');
    setError('');
    try {
      const sel = await getSelectedRecordIds(MAX_BATCH_C);
      if (!sel.ok) {
        setError(sel.reason!);
        return;
      }
      const table = await bitable.base.getActiveTable();
      // 写回目标 = 用户选择的附件字段（询问一次，简化：第一个附件字段）
      const metas = await table.getFieldMetaList();
      const attMeta = metas.find((f) => f.type === 17);
      if (!attMeta) {
        setError('表中没有附件字段可写回');
        return;
      }
      const field = (await table.getField(attMeta.id)) as unknown as AttachmentFieldLike;
      // 逐条渲染该条预览图（单页 png；多页 docx 每页一图的完整实现依 Task 0.2 契约扩展）
      const wbItems = [];
      const filled = await fillForRecords();
      if (!filled) return;
      for (const f of filled) {
        const holder = document.createElement('div');
        holder.style.position = 'fixed';
        holder.style.left = '-9999px';
        document.body.appendChild(holder);
        try {
          await renderAsync(f.docx.buffer as ArrayBuffer, holder);
          const canvas = await html2canvas(holder, { scale: 1.5, backgroundColor: '#ffffff' });
          const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
          if (blob) {
            wbItems.push({ recordId: f.recordId, files: [{ name: safeFileName(f.title, '套打-p1', 'png'), blob }] });
          }
        } finally {
          holder.remove();
        }
      }
      const r = await writeBackBatch(field, wbItems, {
        onProgress: (p) => setStatus(`${t('writeback.progress')}: ${p.done}/${p.total}`),
      });
      setStatus(
        r.ok
          ? `${t('writeback.done')} (${r.succeeded.length})`
          : `${t('writeback.failed')}: ${r.failed.map((x) => x.recordId.slice(-4)).join(', ')}`,
      );
    } finally {
      setBusy(false);
    }
  }, [fillForRecords, getSelectedRecordIds, template, t]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 8 }}>
      <label>
        {t('merge.upload')}
        <input
          type="file"
          accept=".docx"
          onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])}
        />
      </label>
      {template && (
        <div style={{ fontSize: 12, color: 'var(--pd-text-secondary)' }}>
          {template.name}
          {templateRestored && ` · ${t('merge.templateSaved')}`}
        </div>
      )}
      {tags.length > 0 && (
        <div>
          <div style={{ fontWeight: 600 }}>{t('merge.tags')}</div>
          <ul style={{ margin: '4px 0', paddingLeft: 18 }}>
            {tags.map((tag) => {
              const missing = missingTags.includes(tag);
              const meta = fields.find((f) => f.name === tag);
              const unsupported = meta && !TYPE_MAP[meta.type];
              return (
                <li key={tag} style={{ color: missing || unsupported ? 'var(--pd-error)' : undefined }}>
                  {tag}
                  {missing && ` — ${t('merge.tagMissing')}`}
                  {unsupported && ' — 暂不支持该类型'}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button disabled={busy || !template || missingTags.length > 0} onClick={doDownloadZip}>
          {t('merge.downloadZip')}
        </button>
        <button disabled={busy || !template || missingTags.length > 0} onClick={doPreview}>
          {t('merge.preview')}
        </button>
        <button disabled={busy || !template} onClick={doPrint}>
          {t('common.print')}
        </button>
        <button disabled={busy || !template || missingTags.length > 0} onClick={doWriteBack}>
          {t('common.writeBack')}
        </button>
      </div>
      <div style={{ fontSize: 12, color: 'var(--pd-text-secondary)' }}>{t('merge.batchNote')}</div>
      {error && <div style={{ color: 'var(--pd-error)' }}>{error}</div>}
      {status && <div>{status}</div>}
      <div ref={previewRef} className="print-area" style={{ background: '#fff', maxWidth: '100%', overflow: 'auto' }} />
    </div>
  );
}
