# -*- coding: utf-8 -*-
"""
scripts/gen-manual-docx.py  (main)
生成《gyccode 操作手册》docx（公文格式）。

用法:
    python scripts/gen-manual-docx.py
输出:
    docs/gyccode操作手册.docx
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
REPO = os.path.dirname(HERE)
OUT = os.path.join(REPO, "docs", "gyccode操作手册.docx")

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Pt, RGBColor

from manual_docx_style import FONT_BODY, FONT_H1, setup_page, set_doc_defaults, set_run_font
import manual_content_1 as c1
import manual_content_2 as c2
import manual_content_3 as c3
import manual_content_4 as c4
import manual_content_5 as c5
import manual_content_6 as c6
import manual_content_7 as c7

# 文档属性
CORE_TITLE = "gyccode 操作手册"
CORE_SUBJECT = "自研编码智能体 CLI 完整操作指南"
CORE_AUTHOR = "gyc-code 项目组"
CORE_CATEGORY = "操作手册"
CORE_KEYWORDS = "gyccode; AI 编码助手; CLI; 操作手册; 公文格式"
SYNC_TOKEN = "sync:commit=INITIAL"


def stamp_sync_token(doc):
    """在文档中写入同步标记, 供 sync-manual.mjs 判定手册是否已随代码更新。"""
    p = doc.add_paragraph()
    set_run_font(p.add_run("<!-- " + SYNC_TOKEN + " -->"), "Consolas", Pt(8))
    p.paragraph_format.line_spacing = Pt(10)


def add_outline(doc):
    """写入大纲视图: 为各级标题设置大纲级别, 便于在 Word 中折叠与生成目录。"""
    outline_map = {}
    for name, level in (("Heading 1", 0), ("Heading 2", 1), ("Heading 3", 2), ("Heading 4", 3)):
        try:
            st = doc.styles[name]
        except KeyError:
            continue
        st.font.name = "Times New Roman"
        # Word 内置 Heading 默认为蓝色主题色, 公文标题必须显式改回黑色
        st.font.color.rgb = RGBColor(0, 0, 0)
        ppr = st.element.get_or_add_pPr()
        ol = OxmlElement("w:outlineLvl")
        ol.set(qn("w:val"), str(level))
        ppr.append(ol)
        outline_map[name] = level
    return outline_map


def add_toc(doc):
    """插入可更新的目录域 (TOC \\o "1-3"), 并让 Word 打开时提示更新域。"""
    p = doc.add_paragraph()
    p.paragraph_format.line_spacing = Pt(24)
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_run_font(p.add_run("目　　录"), FONT_H1, Pt(16))

    toc_p = doc.add_paragraph()
    run = toc_p.add_run()
    begin = OxmlElement("w:fldChar")
    begin.set(qn("w:fldCharType"), "begin")
    instr = OxmlElement("w:instrText")
    instr.set(qn("xml:space"), "preserve")
    instr.text = r' TOC \o "1-2" \h \z \u '
    sep = OxmlElement("w:fldChar")
    sep.set(qn("w:fldCharType"), "separate")
    placeholder = OxmlElement("w:t")
    placeholder.text = "（在 Word 中按 Ctrl+A 后按 F9 可更新目录）"
    end = OxmlElement("w:fldChar")
    end.set(qn("w:fldCharType"), "end")
    for el in (begin, instr, sep, placeholder, end):
        run._r.append(el)
    set_run_font(run, FONT_BODY, Pt(12))

    # 让 Word 打开文档时自动更新域(否则目录显示占位提示)
    settings = doc.settings.element
    upd = OxmlElement("w:updateFields")
    upd.set(qn("w:val"), "true")
    settings.append(upd)


def main():
    doc = Document()
    set_doc_defaults(doc)
    setup_page(doc)
    add_outline(doc)

    cp = doc.core_properties
    cp.title = CORE_TITLE
    cp.subject = CORE_SUBJECT
    cp.author = CORE_AUTHOR
    cp.category = CORE_CATEGORY
    cp.keywords = CORE_KEYWORDS
    cp.comments = "依据源码与程序实测输出编制；由 scripts/gen-manual-docx.py 生成"

    c1.front_matter(doc)
    # 目录单独占页
    doc.add_page_break()
    add_toc(doc)
    doc.add_page_break()
    c1.chapter1(doc)
    c1.chapter2(doc)
    c1.chapter3(doc)
    c1.chapter4(doc)
    c2.chapter5(doc)
    c2.chapter6(doc)
    c3.chapter7(doc)
    c3.chapter8(doc)
    c3.chapter9(doc)
    c3.chapter10(doc)
    c4.chapter11(doc)
    c4.chapter12(doc)
    c4.chapter13(doc)
    c4.chapter14(doc)
    c4.chapter15(doc)
    c5.chapter16(doc)
    c6.chapter17(doc)
    c6.chapter18(doc)
    c7.chapter19(doc)
    c7.chapter20(doc)
    c7.chapter21(doc)
    c4.closing(doc)
    stamp_sync_token(doc)

    doc.save(OUT)
    size = os.path.getsize(OUT)
    print("[manual] 已生成: %s (%.1f KB)" % (OUT, size / 1024.0))


if __name__ == "__main__":
    main()
