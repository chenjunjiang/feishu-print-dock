// template.ts 单测：占位解析（跨 run/页眉页脚/表格单元格/重复/相邻/转义/非法）+ zip 防线 + 填充
import { describe, it, expect } from 'vitest';
import PizZip from 'pizzip';
import { extractTags, fillTemplate, precheckZip, rejectExternalRels, ZIP_LIMITS } from '../src/engine/template';

/** 现场构造最小 docx（PizZip）：document.xml + 可选额外部件 */
function makeDocx(parts: { documentXml: string; headerXml?: string; relsXml?: string }): Uint8Array {
  const zip = new PizZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${parts.documentXml}</w:body></w:document>`);
  zip.file('word/_rels/document.xml.rels', parts.relsXml ?? `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`);
  if (parts.headerXml) {
    zip.file('word/header1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${parts.headerXml}</w:hdr>`);
  }
  return zip.generate({ type: 'uint8array', compression: 'DEFLATE' });
}

/** 跨 run 拆分的占位（Word 真实行为：{姓名} 拆成多个 <w:t>） */
const RUN_SPLIT_XML = `<w:p><w:r><w:t>{姓</w:t></w:r><w:r><w:t>名}</w:t></w:r></w:p>`;
const PARA = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

describe('extractTags 占位解析', () => {
  it('基本占位提取', () => {
    const docx = makeDocx({ documentXml: PARA('姓名：{姓名}，订单：{订单编号}') });
    const r = extractTags(docx);
    expect(r.ok).toBe(true);
    expect(r.tags.sort()).toEqual(['姓名', '订单编号'].sort());
  });

  it('跨 run 拆分占位（{姓 + 名}）合并识别', () => {
    const docx = makeDocx({ documentXml: RUN_SPLIT_XML });
    const r = extractTags(docx);
    expect(r.ok).toBe(true);
    expect(r.tags).toContain('姓名');
  });

  it('表格单元格内占位', () => {
    const tbl = `<w:tbl><w:tr><w:tc>${PARA('{商品}')}</w:tc><w:tc>${PARA('{数量}')}</w:tc></w:tr></w:tbl>`;
    const r = extractTags(makeDocx({ documentXml: tbl }));
    expect(r.tags.sort()).toEqual(['商品', '数量'].sort());
  });

  it('重复占位去重', () => {
    const r = extractTags(makeDocx({ documentXml: PARA('{姓名}和{姓名}') }));
    expect(r.tags).toEqual(['姓名']);
  });

  it('相邻占位分别识别', () => {
    const r = extractTags(makeDocx({ documentXml: PARA('{姓}{名}') }));
    expect(r.tags.sort()).toEqual(['名', '姓'].sort());
  });

  it('非 docx（缺 document.xml）显式报错', () => {
    const zip = new PizZip();
    zip.file('readme.txt', 'not a docx');
    const r = extractTags(zip.generate({ type: 'uint8array' }));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('word/document.xml');
  });

  it('损坏文件显式报错（不卡死）', () => {
    const r = extractTags(new Uint8Array([1, 2, 3, 4, 5]));
    expect(r.ok).toBe(false);
    expect(r.reason).toBeTruthy();
  });

  it('外部资源引用（TargetMode=External）拒绝', () => {
    const docx = makeDocx({
      documentXml: PARA('{姓名}'),
      relsXml: `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId9" Type="http://x/y" Target="https://evil.example.com/x" TargetMode="External"/></Relationships>`,
    });
    const r = extractTags(docx);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('External');
  });
});

describe('precheckZip 防线', () => {
  it('正常 docx 通过', () => {
    expect(precheckZip(makeDocx({ documentXml: PARA('x') })).ok).toBe(true);
  });

  it('非法 ZIP 拒绝', () => {
    const r = precheckZip(new Uint8Array([0x50, 0x4b, 1, 2, 3]));
    expect(r.ok).toBe(false);
  });

  it('预算常量锁定', () => {
    expect(ZIP_LIMITS.maxEntries).toBe(1000);
    expect(ZIP_LIMITS.maxRealTotal).toBe(100 * 1024 * 1024);
  });

  it('rejectExternalRels：无外部引用通过', () => {
    const r = rejectExternalRels(new PizZip(makeDocx({ documentXml: PARA('x') })));
    expect(r.ok).toBe(true);
  });
});

describe('fillTemplate 填充', () => {
  it('占位被记录值替换（跨 run 占位同样生效）', () => {
    const docx = makeDocx({ documentXml: RUN_SPLIT_XML + PARA('订单：{订单编号}') });
    const out = fillTemplate(docx, { 姓名: '张三', 订单编号: 'A-1024' });
    const zip = new PizZip(out);
    const xml = zip.files['word/document.xml'].asText();
    expect(xml).toContain('张三');
    expect(xml).toContain('A-1024');
    expect(xml).not.toContain('{姓名}');
  });

  it('特殊字符（XML 转义）不破坏 OOXML', () => {
    const docx = makeDocx({ documentXml: PARA('{备注}') });
    const out = fillTemplate(docx, { 备注: 'a<b & "c"' });
    const zip = new PizZip(out);
    const xml = zip.files['word/document.xml'].asText();
    // docxtemplater 负责转义；产物可被 PizZip 重新打开且含转义内容
    expect(xml).toContain('a&lt;b');
    expect(xml).toContain('&amp;');
  });

  it('缺失占位按空串填充（docxtemplater 默认）', () => {
    const docx = makeDocx({ documentXml: PARA('[{不存在}]') });
    const out = fillTemplate(docx, {});
    const xml = new PizZip(out).files['word/document.xml'].asText();
    expect(xml).not.toContain('{不存在}');
  });
});
