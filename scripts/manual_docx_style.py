# -*- coding: utf-8 -*-
"""
scripts/gen-manual-docx.py
把《gyccode 操作手册》正文渲染成符合 GB/T 9704 风格的正式公文版式 docx。

版式基准（GB/T 9704-2012 党政机关公文格式）:
  - 用纸 A4; 版心 上37mm 下35mm 左28mm 右26mm
  - 正文 仿宋 三号(16pt); 固定行距 29pt -> 版心 225mm 内 22 行
  - 标题 宋体加粗 二号(22pt) 居中
  - 一级标题 "一、"   黑体 三号
  - 二级标题 "（一）" 楷体 三号
  - 三级标题 "1."    仿宋加粗 三号
  - 四级标题 "（1）" 仿宋 三号
  - 页码 宋体 四号; 奇数页居右、偶数页居左

内容与渲染分离: 正文在 build_body() 内, 排版规则在本文件顶部常量。
"""
import os
import re
import sys

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

# ---------------------------------------------------------------- 版式常量
FONT_TITLE = "宋体"        # 无方正小标宋简体时以宋体加粗替代
FONT_BODY = "仿宋"
FONT_H1 = "黑体"
FONT_H2 = "楷体"
FONT_ASCII = "Times New Roman"

SZ_TITLE = Pt(22)          # 二号
SZ_BODY = Pt(16)           # 三号
SZ_TABLE = Pt(10.5)        # 五号
SZ_PAGENO = Pt(14)         # 四号

LINE_BODY = Pt(29)         # 固定行距, 版心 22 行
INDENT_2CHAR = Pt(32)      # 首行缩进 2 字符 (三号字 16pt x 2)


# ---------------------------------------------------------------- 底层工具
def set_run_font(run, cn_font, size, bold=False):
    """同时设置西文字体与中文字体(eastAsia), 否则 Word 里中文会回退默认字体。"""
    run.font.name = FONT_ASCII
    run.font.size = size
    run.font.bold = bold
    rpr = run._element.get_or_add_rPr()
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        rfonts = OxmlElement("w:rFonts")
        rpr.append(rfonts)
    rfonts.set(qn("w:ascii"), FONT_ASCII)
    rfonts.set(qn("w:hAnsi"), FONT_ASCII)
    rfonts.set(qn("w:eastAsia"), cn_font)


def set_para_spacing(par, line=LINE_BODY, before=Pt(0), after=Pt(0), indent_chars=2):
    """固定行距 + 首行缩进 N 字符。indent_chars=0 表示不缩进。"""
    pf = par.paragraph_format
    pf.line_spacing = line
    pf.space_before = before
    pf.space_after = after
    if indent_chars:
        ppr = par._p.get_or_add_pPr()
        ind = ppr.find(qn("w:ind"))
        if ind is None:
            ind = OxmlElement("w:ind")
            ppr.append(ind)
        # firstLineChars 以 1/100 字符为单位, 是中文排版的正确表达
        ind.set(qn("w:firstLineChars"), str(indent_chars * 100))
        ind.set(qn("w:firstLine"), str(int(SZ_BODY.pt * indent_chars * 20)))


def para(doc, text, cn_font=FONT_BODY, size=SZ_BODY, bold=False,
         align=WD_ALIGN_PARAGRAPH.JUSTIFY, indent_chars=2,
         line=LINE_BODY, before=Pt(0), after=Pt(0)):
    p = doc.add_paragraph()
    p.alignment = align
    set_para_spacing(p, line=line, before=before, after=after, indent_chars=indent_chars)
    if text:
        set_run_font(p.add_run(text), cn_font, size, bold)
    return p


def body(doc, text):
    """正文段落: 仿宋三号, 首行缩进 2 字符, 两端对齐。"""
    return para(doc, text, FONT_BODY, SZ_BODY)


def h1(doc, text):
    """一级标题 '一、': 黑体三号。套 Heading 1 以启用大纲级别与目录。"""
    p = para(doc, text, FONT_H1, SZ_BODY, indent_chars=2, before=Pt(6))
    p.style = doc.styles["Heading 1"]
    set_run_font(p.runs[0], FONT_H1, SZ_BODY)
    return p


def h2(doc, text):
    """二级标题 '（一）': 楷体三号。"""
    p = para(doc, text, FONT_H2, SZ_BODY, indent_chars=2)
    p.style = doc.styles["Heading 2"]
    set_run_font(p.runs[0], FONT_H2, SZ_BODY)
    return p


def h3(doc, text):
    """三级标题 '1.': 仿宋加粗三号。"""
    p = para(doc, text, FONT_BODY, SZ_BODY, bold=True, indent_chars=2)
    p.style = doc.styles["Heading 3"]
    set_run_font(p.runs[0], FONT_BODY, SZ_BODY, bold=True)
    return p


def h4(doc, text):
    """四级标题 '（1）': 仿宋三号。"""
    p = para(doc, text, FONT_BODY, SZ_BODY, indent_chars=2)
    p.style = doc.styles["Heading 4"]
    set_run_font(p.runs[0], FONT_BODY, SZ_BODY)
    return p


def plain(doc, text):
    """不缩进的顶格行, 用于表头前的说明与落款。"""
    return para(doc, text, FONT_BODY, SZ_BODY, indent_chars=0)


def code(doc, text):
    """等宽代码/命令块: 顶格, 小五号, 浅灰底, 段前段后留白。"""
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.LEFT
    set_para_spacing(p, line=Pt(18), indent_chars=0, before=Pt(3), after=Pt(3))
    set_run_font(p.add_run(text), "Consolas", Pt(10.5))
    shade(p, "F2F2F2")
    return p


def shade(par_or_cell, hex_fill):
    """给段落或单元格加底纹。"""
    el = par_or_cell._p if hasattr(par_or_cell, "_p") else par_or_cell._tc
    pr = el.get_or_add_pPr() if hasattr(par_or_cell, "_p") else el.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), hex_fill)
    pr.append(shd)


def add_page_number_field(par):
    """插入 PAGE 域, 用于页码。"""
    run = par.add_run()
    fld_begin = OxmlElement("w:fldChar")
    fld_begin.set(qn("w:fldCharType"), "begin")
    instr = OxmlElement("w:instrText")
    instr.set(qn("xml:space"), "preserve")
    instr.text = " PAGE "
    fld_end = OxmlElement("w:fldChar")
    fld_end.set(qn("w:fldCharType"), "end")
    run._r.append(fld_begin)
    run._r.append(instr)
    run._r.append(fld_end)
    set_run_font(run, FONT_BODY, SZ_PAGENO)


def set_doc_defaults(doc):
    """把默认样式也设成公文正文, 避免回车新段落时字体突变。"""
    style = doc.styles["Normal"]
    style.font.name = FONT_ASCII
    style.font.size = SZ_BODY
    rpr = style.element.get_or_add_rPr()
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        rfonts = OxmlElement("w:rFonts")
        rpr.append(rfonts)
    rfonts.set(qn("w:ascii"), FONT_ASCII)
    rfonts.set(qn("w:eastAsia"), FONT_BODY)
    rfonts.set(qn("w:hAnsi"), FONT_ASCII)


def setup_page(doc):
    """A4 + 公文版心 + 奇偶页外侧页码。"""
    sec = doc.sections[0]
    sec.page_width = Cm(21.0)
    sec.page_height = Cm(29.7)
    sec.top_margin = Cm(3.7)
    sec.bottom_margin = Cm(3.5)
    sec.left_margin = Cm(2.8)
    sec.right_margin = Cm(2.6)
    sec.header_distance = Cm(2.0)
    sec.footer_distance = Cm(2.0)

    # 奇偶页不同: 单页码居右, 双页码居左
    settings = doc.settings.element
    even_odd = OxmlElement("w:evenAndOddHeaders")
    settings.append(even_odd)

    # 默认 footer = 奇数页, 右对齐
    f_odd = sec.footer
    f_odd.is_linked_to_previous = False
    p_odd = f_odd.paragraphs[0]
    p_odd.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p_odd.paragraph_format.space_before = Pt(0)
    p_odd.paragraph_format.space_after = Pt(0)
    add_page_number_field(p_odd)

    # 偶数页 footer, 左对齐
    f_even = sec.even_page_footer
    f_even.is_linked_to_previous = False
    p_even = f_even.paragraphs[0]
    p_even.alignment = WD_ALIGN_PARAGRAPH.LEFT
    p_even.paragraph_format.space_before = Pt(0)
    p_even.paragraph_format.space_after = Pt(0)
    add_page_number_field(p_even)
    return sec


def table(doc, rows, widths=None, header=True, size=SZ_TABLE):
    """公文表格: 全框线, 表头黑体居中, 正文宋体五号, 单元格自动换行。"""
    ncol = len(rows[0])
    bad = [i for i, r in enumerate(rows) if len(r) != ncol]
    if bad:
        raise ValueError(
            "表格列数不一致: 表头 %d 列, 以下行列数异常 %s (各行实际 %s)"
            % (ncol, bad, [len(r) for r in rows])
        )
    t = doc.add_table(rows=len(rows), cols=ncol)
    t.style = "Table Grid"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    t.autofit = True
    for ri, row in enumerate(rows):
        for ci, val in enumerate(row):
            cell = t.cell(ri, ci)
            cell.text = ""
            p = cell.paragraphs[0]
            p.alignment = WD_ALIGN_PARAGRAPH.LEFT if ci == 0 else WD_ALIGN_PARAGRAPH.LEFT
            set_para_spacing(p, line=Pt(16), indent_chars=0, before=Pt(1), after=Pt(1))
            text = "" if val is None else str(val)
            is_head = header and ri == 0
            set_run_font(p.add_run(text), FONT_H1 if is_head else FONT_BODY, size, is_head)
            if is_head:
                shade(cell, "F2F2F2")
    if widths:
        for ci, w in enumerate(widths):
            for ri in range(len(rows)):
                t.cell(ri, ci).width = Cm(w)
    return t


def note(doc, text):
    """提示框: 公文里的'注:'，楷体小一号顶格。"""
    return para(doc, text, FONT_H2, Pt(14), indent_chars=0, before=Pt(4), after=Pt(4))
