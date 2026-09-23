# -*- coding: utf-8 -*-
"""Genereert docs/Handleiding-Batterij-Regeling.pdf (invulbaar én printbaar).

Gebruik: python tools/make_manual.py
"""
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, Table, TableStyle,
    PageBreak, KeepTogether, Flowable, NextPageTemplate, CondPageBreak,
)
from reportlab.platypus.tableofcontents import TableOfContents
from reportlab.graphics.shapes import Drawing, Rect, String, Line, Polygon

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'docs', 'Handleiding-Batterij-Regeling.pdf')
FONTS = r'C:\Windows\Fonts'

pdfmetrics.registerFont(TTFont('Arial', os.path.join(FONTS, 'arial.ttf')))
pdfmetrics.registerFont(TTFont('Arial-Bold', os.path.join(FONTS, 'arialbd.ttf')))
pdfmetrics.registerFont(TTFont('Arial-Italic', os.path.join(FONTS, 'ariali.ttf')))
pdfmetrics.registerFontFamily('Arial', normal='Arial', bold='Arial-Bold', italic='Arial-Italic',
                              boldItalic='Arial-Bold')

GREEN = colors.HexColor('#1F8A4C')
GREEN_LIGHT = colors.HexColor('#E8F4EC')
GREY = colors.HexColor('#5B6770')
GREY_LIGHT = colors.HexColor('#F3F5F6')
LINE = colors.HexColor('#C9D1D6')
AMBER = colors.HexColor('#B7791F')
AMBER_LIGHT = colors.HexColor('#FDF4E3')
FIELD_BG = colors.HexColor('#F7FBF8')

PAGE_W, PAGE_H = A4
MARGIN = 18 * mm
CONTENT_W = PAGE_W - 2 * MARGIN

# ---------------------------------------------------------------- styles
S = {}
S['body'] = ParagraphStyle('body', fontName='Arial', fontSize=9.5, leading=13.5, spaceAfter=5,
                           textColor=colors.HexColor('#1D252B'))
S['small'] = ParagraphStyle('small', parent=S['body'], fontSize=8.3, leading=11, spaceAfter=0)
S['cell'] = ParagraphStyle('cell', parent=S['body'], fontSize=8.8, leading=11.5, spaceAfter=0)
S['cellb'] = ParagraphStyle('cellb', parent=S['cell'], fontName='Arial-Bold')
S['th'] = ParagraphStyle('th', parent=S['cell'], fontName='Arial-Bold', textColor=colors.white)
S['h1'] = ParagraphStyle('h1', fontName='Arial-Bold', fontSize=17, leading=21, textColor=GREEN,
                         spaceBefore=4, spaceAfter=10)
S['h2'] = ParagraphStyle('h2', fontName='Arial-Bold', fontSize=12, leading=15, textColor=colors.HexColor('#1D252B'),
                         spaceBefore=10, spaceAfter=5)
S['h3'] = ParagraphStyle('h3', fontName='Arial-Bold', fontSize=10, leading=13, textColor=GREEN,
                         spaceBefore=6, spaceAfter=3)
S['bullet'] = ParagraphStyle('bullet', parent=S['body'], leftIndent=12, bulletIndent=2, spaceAfter=2)
S['toc1'] = ParagraphStyle('toc1', fontName='Arial-Bold', fontSize=10, leading=17, leftIndent=0)
S['toc2'] = ParagraphStyle('toc2', fontName='Arial', fontSize=9, leading=13, leftIndent=14)


# ---------------------------------------------------------------- fillable form flowables
class TextField(Flowable):
    """Invulbaar tekstveld (AcroForm) met zichtbare rand, zodat het ook geprint bruikbaar is."""
    _n = 0

    def __init__(self, width, height=16, name=None, tooltip='', multiline=False):
        super().__init__()
        TextField._n += 1
        self.width, self.height = width, height
        self.name = name or f'veld_{TextField._n}'
        self.tooltip = tooltip
        self.multiline = multiline or height > 22

    def wrap(self, aw, ah):
        return self.width, self.height

    def draw(self):
        c = self.canv
        c.saveState()
        if self.multiline:
            # schrijflijnen voor papiergebruik
            c.setStrokeColor(colors.HexColor('#E1E6E9'))
            c.setLineWidth(0.4)
            y = self.height - 15
            while y > 3:
                c.line(4, y, self.width - 4, y)
                y -= 15
        c.restoreState()
        c.acroForm.textfield(
            name=self.name, tooltip=self.tooltip, x=0, y=0, width=self.width, height=self.height,
            relative=True, borderStyle='solid', borderWidth=0.6, borderColor=LINE,
            fillColor=None if self.multiline else FIELD_BG, textColor=colors.black,
            fontName='Helvetica', fontSize=0 if self.multiline else 9,
            fieldFlags='multiline' if self.multiline else '',
        )


class CheckBox(Flowable):
    _n = 0

    def __init__(self, size=11, name=None, tooltip=''):
        super().__init__()
        CheckBox._n += 1
        self.size = size
        self.name = name or f'vink_{CheckBox._n}'
        self.tooltip = tooltip

    def wrap(self, aw, ah):
        return self.size, self.size

    def draw(self):
        self.canv.acroForm.checkbox(
            name=self.name, tooltip=self.tooltip, x=0, y=0, size=self.size, relative=True,
            buttonStyle='check', borderColor=GREEN, fillColor=colors.white, textColor=GREEN,
            borderWidth=0.8, forceBorder=True,
        )


def P(text, style='body'):
    return Paragraph(text, S[style])


def bullets(items):
    return [Paragraph(t, S['bullet'], bulletText='•') for t in items]


def H1(text):
    p = Paragraph(text, S['h1'])
    p._toc = (0, text)
    return p


def H2(text):
    p = Paragraph(text, S['h2'])
    p._toc = (1, text)
    return p


def callout(text, kind='info'):
    bg, bar = (GREEN_LIGHT, GREEN) if kind == 'info' else (AMBER_LIGHT, AMBER)
    label = 'Tip' if kind == 'info' else 'Let op'
    t = Table([[P(f'<b>{label}</b> {text}', 'cell')]], colWidths=[CONTENT_W])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), bg),
        ('LINEBEFORE', (0, 0), (0, -1), 3, bar),
        ('LEFTPADDING', (0, 0), (-1, -1), 8), ('RIGHTPADDING', (0, 0), (-1, -1), 8),
        ('TOPPADDING', (0, 0), (-1, -1), 6), ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
    ]))
    return KeepTogether([Spacer(1, 3), t, Spacer(1, 6)])


def table(rows, widths, header=True, zebra=True):
    data = []
    for i, r in enumerate(rows):
        data.append([c if isinstance(c, Flowable) else P(str(c), 'th' if (header and i == 0) else 'cell')
                     for c in r])
    t = Table(data, colWidths=widths, repeatRows=1 if header else 0)
    st = [
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('GRID', (0, 0), (-1, -1), 0.4, LINE),
        ('LEFTPADDING', (0, 0), (-1, -1), 5), ('RIGHTPADDING', (0, 0), (-1, -1), 5),
        ('TOPPADDING', (0, 0), (-1, -1), 4), ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ]
    if header:
        st.append(('BACKGROUND', (0, 0), (-1, 0), GREEN))
    if zebra:
        for i in range(1 if header else 0, len(rows)):
            if i % 2 == 0:
                st.append(('BACKGROUND', (0, i), (-1, i), GREY_LIGHT))
    t.setStyle(TableStyle(st))
    return t


def checklist(prefix, items, value_label='Waarde / opmerking'):
    """Checklist: [vinkje] controlepunt | invulveld."""
    fw = 62 * mm
    rows = [['OK', 'Controlepunt', value_label]]
    for i, item in enumerate(items, 1):
        text, hint = item if isinstance(item, tuple) else (item, '')
        cell = P(text + (f'<br/><font color="#5B6770" size="7.8">{hint}</font>' if hint else ''), 'cell')
        rows.append([CheckBox(name=f'{prefix}_{i}_ok'), cell,
                     TextField(fw - 10, 16, name=f'{prefix}_{i}_waarde')])
    return table(rows, [10 * mm, CONTENT_W - 10 * mm - fw, fw])


def fields(prefix, labels, label_w=62 * mm):
    """Label | invulveld rijen (meetwaarden)."""
    rows = []
    for i, lab in enumerate(labels, 1):
        rows.append([P(lab, 'cellb'), TextField(CONTENT_W - label_w - 10, 16, name=f'{prefix}_m{i}')])
    t = Table(rows, colWidths=[label_w, CONTENT_W - label_w])
    t.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LINEBELOW', (0, 0), (-1, -1), 0.4, LINE),
        ('LEFTPADDING', (0, 0), (-1, -1), 5), ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
    ]))
    return t


def remarks(prefix, height=60, label='Opmerkingen'):
    return KeepTogether([P(f'<b>{label}</b>', 'small'), Spacer(1, 2),
                         TextField(CONTENT_W, height, name=f'{prefix}_opm'), Spacer(1, 8)])


def result_row(prefix):
    t = Table([[P('<b>Resultaat</b>', 'cell'), CheckBox(name=f'{prefix}_goed'), P('Goedgekeurd', 'cell'),
                CheckBox(name=f'{prefix}_fout'), P('Afgekeurd / actie nodig', 'cell'),
                P('Datum / paraaf', 'cell'), TextField(38 * mm, 16, name=f'{prefix}_paraaf')]],
              colWidths=[22 * mm, 7 * mm, 26 * mm, 7 * mm, 40 * mm, 24 * mm, CONTENT_W - 126 * mm])
    t.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'), ('BACKGROUND', (0, 0), (-1, -1), GREY_LIGHT),
        ('LEFTPADDING', (0, 0), (-1, -1), 4), ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
    ]))
    return t


def test_block(code, title, doel, stappen, verwacht, metingen):
    head = Table([[P(f'<font color="white"><b>{code}</b></font>', 'cell'), P(f'<b>{title}</b>', 'cell')]],
                 colWidths=[16 * mm, CONTENT_W - 16 * mm])
    head.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (0, 0), GREEN), ('BACKGROUND', (1, 0), (1, 0), GREEN_LIGHT),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'), ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5), ('ALIGN', (0, 0), (0, 0), 'CENTER'),
    ]))
    steps = '<br/>'.join(f'{i}. {s}' for i, s in enumerate(stappen, 1))
    body = Table([
        [P('<b>Doel</b>', 'cell'), P(doel, 'cell')],
        [P('<b>Stappen</b>', 'cell'), P(steps, 'cell')],
        [P('<b>Verwacht</b>', 'cell'), P(verwacht, 'cell')],
    ], colWidths=[22 * mm, CONTENT_W - 22 * mm])
    body.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'), ('LINEBELOW', (0, 0), (-1, -2), 0.4, LINE),
        ('LEFTPADDING', (0, 0), (-1, -1), 5), ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ]))
    key = code.lower().replace('-', '')
    parts = [head, body, Spacer(1, 4), P('<b>Gemeten waarden</b>', 'small'), Spacer(1, 2),
             fields(key, metingen), Spacer(1, 4),
             P('<b>Opmerkingen</b>', 'small'), Spacer(1, 2), TextField(CONTENT_W, 34, name=f'{key}_opm'),
             Spacer(1, 4), result_row(key), Spacer(1, 12)]
    return KeepTogether(parts)


# ---------------------------------------------------------------- diagram
def system_diagram():
    w, h = CONTENT_W, 62 * mm
    d = Drawing(w, h)

    def box(x, y, bw, bh, title, sub, fill=GREEN_LIGHT, stroke=GREEN):
        d.add(Rect(x, y, bw, bh, rx=6, ry=6, fillColor=fill, strokeColor=stroke, strokeWidth=1))
        d.add(String(x + bw / 2, y + bh - 16, title, fontName='Arial-Bold', fontSize=9.5,
                     textAnchor='middle', fillColor=colors.HexColor('#1D252B')))
        for i, line in enumerate(sub):
            d.add(String(x + bw / 2, y + bh - 29 - i * 10, line, fontName='Arial', fontSize=7.5,
                         textAnchor='middle', fillColor=GREY))

    def arrow(x1, y1, x2, y2, label='', both=False, dy=4):
        d.add(Line(x1, y1, x2, y2, strokeColor=GREY, strokeWidth=1))
        import math
        ang = math.atan2(y2 - y1, x2 - x1)

        def head(xe, ye, a):
            s = 5
            d.add(Polygon([xe, ye, xe - s * math.cos(a - 0.4), ye - s * math.sin(a - 0.4),
                           xe - s * math.cos(a + 0.4), ye - s * math.sin(a + 0.4)],
                          fillColor=GREY, strokeColor=GREY))
        head(x2, y2, ang)
        if both:
            head(x1, y1, ang + math.pi)
        if label:
            d.add(String((x1 + x2) / 2, (y1 + y2) / 2 + dy, label, fontName='Arial', fontSize=7,
                         textAnchor='middle', fillColor=GREY))

    bw, bh = 44 * mm, 22 * mm
    # rij onder: P1 - Homey - Zendure
    y0 = 6 * mm
    xs = [0, (w - bw) / 2, w - bw]
    box(xs[0], y0, bw, bh, 'HomeWizard P1', ['slimme meter', 'netvermogen (W)'])
    box(xs[1], y0, bw, bh, 'Homey Pro', ['app Batterij Regeling', 'regelt elke 5 s'], fill=colors.white)
    box(xs[2], y0, bw, bh, 'Zendure 2400 AC+', ['thuisbatterij', 'laad / ontlaad (W)'])
    # boven: EnergyZero
    box(xs[1], y0 + bh + 16 * mm, bw, bh - 4 * mm, 'EnergyZero API', ['kwartierprijzen (internet)'],
        fill=AMBER_LIGHT, stroke=AMBER)
    arrow(xs[0] + bw, y0 + bh / 2, xs[1], y0 + bh / 2, 'lokaal HTTP')
    arrow(xs[1] + bw, y0 + bh / 2, xs[2], y0 + bh / 2, 'lokaal HTTP', both=True)
    arrow(xs[1] + bw / 2, y0 + bh + 16 * mm, xs[1] + bw / 2, y0 + bh, '')
    d.add(String(xs[1] + bw / 2 + 4, y0 + bh + 7 * mm, 'elk half uur', fontName='Arial', fontSize=7,
                 fillColor=GREY))
    return d


# ---------------------------------------------------------------- page decoration
def on_page(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(LINE)
    canvas.setLineWidth(0.5)
    canvas.line(MARGIN, PAGE_H - 12 * mm, PAGE_W - MARGIN, PAGE_H - 12 * mm)
    canvas.setFont('Arial', 7.5)
    canvas.setFillColor(GREY)
    canvas.drawString(MARGIN, PAGE_H - 10 * mm, 'Handleiding Batterij Regeling voor Homey  ·  Zendure SolarFlow 2400 AC+')
    canvas.drawRightString(PAGE_W - MARGIN, PAGE_H - 10 * mm, 'versie app 0.4.0')
    canvas.line(MARGIN, 12 * mm, PAGE_W - MARGIN, 12 * mm)
    canvas.drawString(MARGIN, 8 * mm, 'DrPeppers  ·  github.com/WNijhof/homey-battery-control')
    canvas.drawRightString(PAGE_W - MARGIN, 8 * mm, f'pagina {doc.page}')
    canvas.restoreState()


def on_cover(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(GREEN)
    canvas.rect(0, PAGE_H - 95 * mm, PAGE_W, 95 * mm, stroke=0, fill=1)
    # batterij-icoon
    x, y = PAGE_W - MARGIN - 34 * mm, PAGE_H - 78 * mm
    canvas.setStrokeColor(colors.white)
    canvas.setLineWidth(4)
    canvas.roundRect(x, y, 30 * mm, 42 * mm, 4 * mm, stroke=1, fill=0)
    canvas.setFillColor(colors.white)
    canvas.roundRect(x + 9 * mm, y + 42 * mm, 12 * mm, 4 * mm, 1 * mm, stroke=0, fill=1)
    p = canvas.beginPath()
    pts = [(35, 18), (24, 36), (32, 36), (29, 50), (41, 30), (33, 30)]
    sx = 30 * mm / 36
    for i, (px, py) in enumerate(pts):
        X = x + (px - 14) * sx
        Y = y + 42 * mm - (py - 10) * sx
        (p.moveTo if i == 0 else p.lineTo)(X, Y)
    p.close()
    canvas.drawPath(p, stroke=0, fill=1)
    canvas.setFont('Arial-Bold', 28)
    canvas.drawString(MARGIN, PAGE_H - 42 * mm, 'Batterij Regeling')
    canvas.setFont('Arial', 14)
    canvas.drawString(MARGIN, PAGE_H - 52 * mm, 'voor Homey Pro')
    canvas.setFont('Arial', 10.5)
    canvas.drawString(MARGIN, PAGE_H - 68 * mm, 'Installatie-, inbedrijfstellings- en controlehandleiding')
    canvas.drawString(MARGIN, PAGE_H - 74 * mm, 'Zendure SolarFlow 2400 AC+  ·  HomeWizard P1  ·  dynamische kwartierprijzen')
    canvas.restoreState()
    on_page_footer_only(canvas, doc)


def on_page_footer_only(canvas, doc):
    canvas.saveState()
    canvas.setFont('Arial', 7.5)
    canvas.setFillColor(GREY)
    canvas.drawString(MARGIN, 8 * mm, 'DrPeppers  ·  github.com/WNijhof/homey-battery-control')
    canvas.restoreState()


class Doc(BaseDocTemplate):
    def __init__(self, path):
        super().__init__(path, pagesize=A4, leftMargin=MARGIN, rightMargin=MARGIN,
                         topMargin=18 * mm, bottomMargin=18 * mm,
                         title='Handleiding Batterij Regeling voor Homey', author='DrPeppers',
                         subject='Zendure SolarFlow 2400 AC+ aansturing via Homey')
        frame = Frame(MARGIN, 18 * mm, CONTENT_W, PAGE_H - 36 * mm, id='f', leftPadding=0, rightPadding=0,
                      topPadding=0, bottomPadding=0)
        cover_frame = Frame(MARGIN, 18 * mm, CONTENT_W, PAGE_H - 115 * mm, id='c', leftPadding=0,
                            rightPadding=0, topPadding=0, bottomPadding=0)
        self.addPageTemplates([PageTemplate('cover', [cover_frame], onPage=on_cover),
                               PageTemplate('normal', [frame], onPage=on_page)])

    def afterFlowable(self, f):
        if hasattr(f, '_toc'):
            level, text = f._toc
            key = f'h{self.seq.nextf("toc")}'
            self.canv.bookmarkPage(key)
            self.canv.addOutlineEntry(text, key, level=level, closed=level > 0)
            self.notify('TOCEntry', (level, text, self.page, key))


# ---------------------------------------------------------------- hoofdstuk 13: samenwerking
def flow_block(code, title, doel, als, en, dan, noot=''):
    """Flow-voorstel: Als / En / Dan, met vinkje 'ingericht' en veld voor aangepaste waarden."""
    head = Table([[P(f'<font color="white"><b>{code}</b></font>', 'cell'), P(f'<b>{title}</b>', 'cell'),
                   CheckBox(name=f'{code.lower()}_ingericht'), P('ingericht', 'small')]],
                 colWidths=[16 * mm, CONTENT_W - 44 * mm, 8 * mm, 20 * mm])
    head.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (0, 0), colors.HexColor('#1E6FA8')),
        ('BACKGROUND', (1, 0), (-1, 0), colors.HexColor('#E7F0F8')),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'), ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5), ('ALIGN', (0, 0), (0, 0), 'CENTER'),
    ]))
    rows = [[P('<b>Doel</b>', 'cell'), P(doel, 'cell')],
            [P('<b>Als</b>', 'cell'), P(als, 'cell')]]
    if '[Lydos]</b>' in dan:
        demo = '<font color="#1F8A4C"><b>[Batterij]</b></font> Demo-modus staat <b>uit</b>'
        en = f'{en} · {demo}' if en else demo
    if en:
        rows.append([P('<b>En</b>', 'cell'), P(en, 'cell')])
    rows.append([P('<b>Dan</b>', 'cell'), P(dan, 'cell')])
    if noot:
        rows.append([P('<b>Let op</b>', 'cell'), P(noot, 'cell')])
    rows.append([P('<b>Mijn waarden</b>', 'cell'), TextField(CONTENT_W - 32 * mm, 16, name=f'{code.lower()}_waarden')])
    body = Table(rows, colWidths=[22 * mm, CONTENT_W - 22 * mm])
    body.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'), ('LINEBELOW', (0, 0), (-1, -2), 0.4, LINE),
        ('LEFTPADDING', (0, 0), (-1, -1), 5), ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ]))
    return KeepTogether([head, body, Spacer(1, 10)])


def chapter_13():
    B = '<font color="#1F8A4C"><b>[Batterij]</b></font>'
    L = '<font color="#1E6FA8"><b>[Lydos]</b></font>'
    Z = '<font color="#B7791F"><b>[SolarEdge]</b></font>'
    H = '<font color="#5B6770"><b>[Homey]</b></font>'
    K = '<font color="#7A4FB5"><b>[Stekker boiler]</b></font>'
    out = [H1('13. Samenwerking met zonnepanelen en warmtepompboiler'),
           P('Dit hoofdstuk is een voorstel om de thuisbatterij, de zonnepanelen (SolarEdge) en de '
             'warmtepompboiler (Atag Lydos Hybrid, met de eigen Homey-app <i>Atag Lydos</i>) optimaal te laten '
             'samenwerken met Homey Flows. De waarden zijn een startpunt: noteer bij elke Flow wat je uiteindelijk '
             'gebruikt.'),

           H2('13.1 Meetbronnen in Homey'),
           P('Alle onderdelen zijn realtime in Homey te volgen. Elke bron heeft een eigen rol; gebruik voor elke '
             'beslissing de meest directe meting.'),
           table([
               ['Bron', 'Meet', 'Snelheid', 'Gebruik in Flows'],
               ['HomeWizard P1', 'Netafname / teruglevering', 'Realtime (1 s)',
                'Hoofdmeter. Batterij Regeling leest hem zelf lokaal uit; de HomeWizard-app in Homey mag daarnaast '
                'blijven bestaan'],
               ['Batterij Regeling', 'Laadniveau, batterijvermogen, <b>zonne-overschot</b>, prijs, plan', 'Elke 5 s',
                'Sturen op overschot, prijs en laadniveau'],
               ['SolarEdge-omvormer', 'Zonneproductie, dagopbrengst', 'Realtime',
                '„De zon schijnt” (productie &gt; X W), dagopbrengst voor de middagcontrole'],
               ['Tussenstekker boiler', 'Werkelijk verbruik boiler', 'Realtime',
                'Herkennen wat de boiler doet: ~190–220 W = warmtepomp, &gt; 1000 W = element'],
               ['Tussenstekker batterij', 'AC-vermogen batterij', 'Realtime',
                'Alleen controle van de Zendure-waarden; <b>niet</b> voor sturen of schakelen'],
               ['Atag Lydos (eigen app)', 'Water- en doeltemperatuur, modus, douchebeurten', 'Cloud, elke 5 min',
                'Temperatuur en modus instellen; douchebeurten als comfortbewaking'],
           ], [30 * mm, 44 * mm, 22 * mm, CONTENT_W - 96 * mm]),
           Spacer(1, 4),
           P('<b>Waarom het overschot uit Batterij Regeling en niet uit SolarEdge?</b> Zonneproductie alleen zegt '
             'niet hoeveel er over is: het verbruik in huis moet eraf. Het overschot van Batterij Regeling komt '
             'rechtstreeks uit de P1-meter en de batterij (<i>teruglevering + zonnestroom die de batterij in gaat</i>, '
             'gemiddeld over 1 minuut) en klopt dus altijd met wat er werkelijk door de meter gaat. Laden uit het '
             'net in goedkope kwartieren telt niet mee. SolarEdge gebruik je als extra voorwaarde, bijvoorbeeld om '
             'zeker te weten dat het overschot van de zon komt.'),
           P('<b>Boiler: stekker in plaats van de cloudstatus.</b> „Is aan het opwarmen” uit de Lydos-app loopt tot '
             '5 minuten achter. De tussenstekker ziet direct of de warmtepomp of het element draait. Let op: de '
             'warmtepomp werkt alleen bij een luchttemperatuur van 12 tot 40 °C op de plek van de boiler. Is het '
             'kouder (bijvoorbeeld een onverwarmde ruimte in de winter), dan neemt het element het over. Dat zie je '
             'alleen met de stekker (Flow F11).'),
           callout('Tussenstekker batterij: schakel deze nooit uit via een Flow of snelknop; de batterij valt dan '
                   'weg. Controleer ook dat de stekker het vermogen aankan (16 A / 3680 W). Bij een eigen groep met '
                   'meer dan 800 W is een tussenstekker vaak niet geschikt; volg dan het advies van de installateur.',
                   'warn'),

           H2('13.2 Homey Energy: dubbeltellingen voorkomen'),
           P('Homey Energy telt het verbruik van alle apparaten met een vermogensmeting op. Omdat de batterij nu '
             'twee keer gemeten wordt (Batterij Regeling en de tussenstekker), stel je dit zo in:'),
           table([
               ['Apparaat', 'Rol in Homey Energy', 'Instelling'],
               ['HomeWizard P1 (HomeWizard-app)', 'Hoofdmeter (net)', 'Standaard; dit is de referentie'],
               ['SolarEdge', 'Zonnepanelen', 'Standaard'],
               ['Batterij Regeling', 'Thuisbatterij', 'Standaard (laden +, ontladen −)'],
               ['Tussenstekker batterij', '— (niet meetellen)',
                'Apparaat → Instellingen → Energie: uitsluiten / niet meetellen in Energie'],
               ['Tussenstekker boiler', 'Verbruiker', 'Standaard; eventueel apparaattype op „Boiler” zetten'],
           ], [48 * mm, 40 * mm, CONTENT_W - 88 * mm]),
           Spacer(1, 4),
           P('De exacte naam van de optie verschilt per Homey-versie. Controle: het huisverbruik in Homey Energy '
             'moet ongeveer gelijk zijn aan <i>P1-afname + zonneproductie − teruglevering − batterij laden + '
             'batterij ontladen</i>.', 'small'),

           H2('13.3 Werken ze in de basis al samen?'),
           P('<b>Deels, en zonder dat je iets instelt.</b> Batterij Regeling ziet via de P1-meter alles wat in huis '
             'verbruikt wordt, dus ook de boiler. Er is geen directe koppeling tussen de apps; de samenwerking '
             'ontstaat via de P1-meting en via Flows. Zonder Flows gebeurt het volgende:'),
           table([
               ['Situatie', 'Gedrag zonder Flows', 'Gevolg'],
               ['Boiler warmt overdag op met zon', 'Batterij laadt iets minder (P1 ziet de 190 W)',
                'Goed: de zonnestroom gaat naar de boiler, de rest naar de batterij'],
               ['Boiler warmt ’s avonds of ’s nachts op (eigen programma of i-Memory)',
                'Batterij levert de 190 W (zelfconsumptie/dynamisch ontladen)',
                'Batterij-energie gaat naar de boiler en is sneller leeg in de dure uren'],
               ['Boiler in Boost (element 1200 W)', 'Batterij levert maximaal 800 W, de rest komt van het net',
                'Duur als dit in de avondpiek gebeurt'],
               ['Boiler in i-Memory', 'Boiler bepaalt zelf tijden en temperatuur',
                'Homey-instellingen worden na verloop van tijd overschreven'],
           ], [48 * mm, 58 * mm, CONTENT_W - 106 * mm]),
           Spacer(1, 4),
           P('Het doel van de Flows hieronder: <b>de boiler zo veel mogelijk met zonnestroom of in goedkope '
             'kwartieren laten opwarmen, en nooit in de dure avonduren</b>. De batterij blijft dan beschikbaar '
             'voor de rest van het huis.'),

           H2('13.4 Uitgangspunten'),
           *bullets([
               '<b>Boiler in modus Green.</b> Alleen in Green doet de boiler precies wat Homey vraagt (alleen '
               'warmtepomp, 40–53 °C). i-Memory past de temperatuur zelf aan, Programma volgt eigen tijden.',
               '<b>Twee temperaturen:</b> een <i>basis</i> (voorstel 45 °C, genoeg voor de avond en ochtend) en een '
               '<i>buffer</i> (53 °C, het maximum van de warmtepomp). Opwarmen van basis naar buffer is een '
               'goedkope „thermische batterij”.',
               '<b>Boiler en batterij tegelijk.</b> De warmtepomp neemt maar ~190 W. Bij zonne-overschot kunnen '
               'boiler en batterij dus tegelijk laden; de zelfconsumptieregeling verdeelt dat vanzelf.',
               '<b>Element (Boost) alleen bij groot overschot of negatieve prijzen.</b> 1200 W elektrisch '
               'verwarmen (COP 1) is alleen zinvol als de stroom anders wordt teruggeleverd tegen een lage of '
               'negatieve prijs, of als legionellapreventie.',
               '<b>Lydos-app 1.2.0 of nieuwer.</b> Die versie wacht bij „Boost + hoge temperatuur” in één Flow op '
               'de moduswissel, stuurt geen opdrachten die niets veranderen en pauzeert zelf bij te veel verzoeken. '
               'Met een oudere versie: zet de temperatuurkaart 10 s later dan de moduskaart.',
               '<b>Opwarmen herkennen met de stekker.</b> Gebruik het vermogen van de boiler-stekker om te zien wat de '
               'boiler doet (± 200 W warmtepomp, &gt; 1000 W element), niet de vertraagde cloudstatus.',
               '<b>Weinig schakelen.</b> De Ariston-cloud blokkeert bij te veel verzoeken (HTTP 429). De '
               'overschot-triggers van Batterij Regeling gaan daarom één keer af (niet elke 5 s), en gebruiken een '
               'minimale duur.',
               '<b>Comfort gaat voor.</b> Zijn er te weinig douchebeurten, dan warmt de boiler altijd op, ook in '
               'dure uren.',
           ]),

           H2('13.5 Dagverloop in één oogopslag'),
           table([
               ['Periode', 'Batterij', 'Boiler (Green)', 'Stuurt via'],
               ['Nacht 22–07', 'Dynamisch: laden in goedkoopste kwartieren', 'Basis 45 °C; opwarmen alleen in '
                'goedkope kwartieren als hij te koud is', 'F4, F5'],
               ['Ochtend 07–10', 'Dekt verbruik (ontbijt, douchen)', 'Basis 45 °C; alleen opwarmen bij te weinig '
                'douchebeurten', 'F6'],
               ['Dag 10–16', 'Laadt met zonne-overschot', 'Buffer 53 °C zodra er overschot is; element bij groot '
                'overschot en volle batterij', 'F1, F2, F3'],
               ['Controle 16:00', '—', 'Nog koud na een bewolkte dag? Opwarmen in het volgende goedkope kwartier',
                'F7'],
               ['Avond 17–22', 'Ontlaadt in de duurste kwartieren', 'Basis 45 °C, niet opwarmen', 'F5'],
               ['Wekelijks', '—', 'Legionellapreventie ≥ 60 °C, bij voorkeur met zon', 'F9'],
           ], [26 * mm, 50 * mm, CONTENT_W - 102 * mm, 26 * mm]),
           PageBreak(),

           H2('13.6 Voorgestelde Flows'),
           P(f'Labels geven aan uit welke app de kaart komt: {B} Batterij Regeling, {L} Atag Lydos, '
             f'{Z} SolarEdge, {K} tussenstekker boiler, {H} Homey zelf (Datum &amp; tijd, Logica). Stel eerst eenmalig de boiler in op '
             f'<b>Green</b> en maak in Homey (Logica) een variabele <i>BoilerBuffer</i> (ja/nee) aan; die '
             f'onthoudt of de boiler op buffertemperatuur staat. Elke Flow die de boiler aanstuurt heeft de '
             f'voorwaarde {B} <i>Demo-modus staat uit</i>, zodat de boiler tijdens de proefperiode zijn eigen '
             f'programma volgt (hoofdstuk 6a).'),
           flow_block('F1', 'Zonne-overschot → boiler bufferen',
                      'Overtollige zonnestroom opslaan als warm water.',
                      f'{B} Zonne-overschot is <b>10</b> minuten boven <b>400 W</b>',
                      f'{L} Modus is Green · {H} BoilerBuffer is nee · {H} Logica: {Z} <i>productie</i> is hoger '
                      f'dan <b>1000 W</b>',
                      f'{L} Stel temperatuur in op <b>53 °C</b> · {H} BoilerBuffer = ja',
                      'Drempel ruim boven 190 W, zodat er na het starten van de warmtepomp nog overschot over is '
                      'en de Flow niet pendelt.'),
           flow_block('F2', 'Overschot voorbij → terug naar basis',
                      'Bij bewolking of einde van de dag stoppen met bufferen.',
                      f'{B} Zonne-overschot is <b>20</b> minuten onder <b>100 W</b>',
                      f'{H} BoilerBuffer is ja · {B} Geplande actie is niet Laden',
                      f'{L} Zet modus op <b>Green</b> · {L} Stel temperatuur in op <b>45 °C</b> · {H} BoilerBuffer = nee',
                      'Zet ook de modus terug, voor het geval F3 het element had aangezet. Het water dat al warm is blijft warm; de boiler stopt alleen met verder opwarmen.'),
           flow_block('F3', 'Groot overschot en volle batterij → element bijschakelen',
                      'Als de batterij vol is en er veel wordt teruggeleverd, het element gebruiken voor extra '
                      'buffer (tot 60–65 °C).',
                      f'{B} Zonne-overschot is <b>10</b> minuten boven <b>1400 W</b>',
                      f'{B} Laadniveau is hoger dan <b>95 %</b> · {L} Modus is Green · {H} BoilerKlaar is ja (F12)',
                      f'{L} Zet modus op <b>Boost</b> · {L} Stel temperatuur in op <b>60 °C</b> · '
                      f'na <b>90</b> min (of via F2): {L} modus <b>Green</b>, temperatuur <b>53 °C</b>',
                      'Alleen zinvol als teruglevering weinig oplevert (na de saldering of bij lage prijzen). '
                      'Het element verbruikt 1200 W; houd de drempel boven dat vermogen.'),
           flow_block('F4', 'Goedkoop kwartier → boiler opwarmen (bewolkte dagen, nacht)',
                      'Als er geen zon is, de boiler in de goedkoopste kwartieren opwarmen.',
                      f'{B} Geplande actie is veranderd',
                      f'{B} Geplande actie is <b>Laden</b> · {H} Logica: <i>Watertemperatuur</i> (Lydos) is lager dan <b>48</b>',
                      f'{L} Stel temperatuur in op <b>53 °C</b> · {H} BoilerBuffer = ja',
                      'Werkt alleen met strategie Dynamisch. De batterij laadt in hetzelfde kwartier uit het net; '
                      'de boiler gebruikt dan ook goedkope stroom.'),
           flow_block('F5', 'Dure kwartieren → boiler niet laten opwarmen',
                      'Voorkomen dat de boiler in de avondpiek (via de batterij of het net) gaat verwarmen.',
                      f'{B} Geplande actie is veranderd',
                      f'{B} Geplande actie is <b>Ontladen</b> of <b>Vasthouden</b> · {B} Zonne-overschot is lager '
                      f'dan <b>300 W</b>',
                      f'{L} Stel temperatuur in op <b>45 °C</b> · {H} BoilerBuffer = nee',
                      'Maak twee Flows (één voor Ontladen, één voor Vasthouden) of gebruik een Advanced Flow met '
                      'een OF-blok. De voorwaarde op overschot voorkomt dat F1 direct wordt teruggedraaid.'),
           flow_block('F6', 'Comfort: te weinig douchebeurten → altijd opwarmen',
                      'Nooit zonder warm water zitten, ongeacht de prijs.',
                      f'{L} Beschikbare douchebeurten gedaald onder <b>2</b>',
                      '',
                      f'{L} Zet modus op <b>Green</b> · {L} Stel temperatuur in op <b>53 °C</b> · '
                      f'{H} BoilerBuffer = ja · optioneel {H} melding „Boiler warmt op (comfort)”',
                      'Heeft voorrang op F5: F5 draait alleen bij een planwissel, F6 bij een daling van de '
                      'douchebeurten. Controleer het aantal dat bij jouw gebruik past.'),
           flow_block('F7', 'Controle 16:00 na een bewolkte dag',
                      'Als de zon onvoldoende heeft opgeleverd, zorgen dat de boiler vóór de avond op basis is.',
                      f'{H} Het is <b>16:00</b>',
                      f'{H} Logica: <i>Watertemperatuur</i> (Lydos) is lager dan <b>45</b> · optioneel {H} Logica: '
                      f'{Z} <i>dagopbrengst</i> is lager dan <b>X kWh</b>',
                      f'{L} Stel temperatuur in op <b>50 °C</b> (warmtepomp, ~1–2 uur)',
                      'Om 16:00 zijn de prijzen meestal nog lager dan in de avondpiek. Met strategie Dynamisch kan '
                      'F4 dit ook ’s nachts oplossen; kies wat bij je comfort past.'),
           flow_block('F8', 'Negatieve prijs → alles aan',
                      'Bij negatieve stroomprijzen zo veel mogelijk stroom afnemen.',
                      f'{B} Geplande actie is veranderd',
                      f'{B} Prijs is lager dan <b>€ 0,00</b>',
                      f'{L} Zet modus op <b>Boost</b> · {L} Stel temperatuur in op <b>65 °C</b>. '
                      f'Terug: bij de volgende planwissel met prijs hoger dan € 0,00 en {L} modus is Boost → '
                      f'modus <b>Green</b>, <b>53 °C</b>',
                      'De batterij laadt bij negatieve prijzen al automatisch (strategie Dynamisch). De prijs in '
                      'Homey is all-in; stel de drempel eventueel in op de pure marktprijs min opslag en belasting.'),
           flow_block('F9', 'Wekelijkse legionellapreventie',
                      'Het water eens per week boven 60 °C, bij voorkeur met zonnestroom.',
                      f'{H} Elke <b>zondag 12:00</b>',
                      '',
                      f'{L} Zet modus op <b>Boost</b> · {L} Stel temperatuur in op <b>60 °C</b> · na <b>2 uur</b>: '
                      f'{L} modus <b>Green</b>, <b>53 °C</b>',
                      'Controleer eerst of de anti-legionellafunctie van de boiler zelf al aan staat (installateurs-'
                      'menu of Atag-app). Dan is deze Flow niet nodig.'),
           flow_block('F11', 'Element onverwacht aan → melding',
                      'Opmerken wanneer de boiler zelf het element gebruikt (koude ruimte, i-Memory, '
                      'anti-legionella), zeker op een duur moment.',
                      f'{K} Vermogen is veranderd',
                      f'{H} Logica: <i>Vermogen</i> (stekker boiler) is hoger dan <b>1000 W</b> · {L} Modus is niet '
                      f'Boost · {B} Zonne-overschot is lager dan <b>1000 W</b>',
                      f'{H} Stuur pushbericht „Boiler gebruikt het element: [Watertemperatuur] °C”',
                      'Bewust alleen een melding, geen ingreep: de boiler kan het element nodig hebben voor '
                      'legionellapreventie of omdat de warmtepomp te koude lucht heeft. Beperk meldingen met een '
                      'Logica-variabele (maximaal één per uur). Gebeurt dit vaak, controleer dan de ruimtetemperatuur.'),
           flow_block('F12', 'Boiler klaar → status bijwerken',
                      'Direct weten wanneer de boiler op temperatuur is, zonder op de cloud te wachten.',
                      f'{K} Vermogen is veranderd',
                      f'{H} Logica: <i>Vermogen</i> (stekker boiler) is lager dan <b>30 W</b> · {H} BoilerBuffer is ja',
                      f'{H} Logica: variabele <i>BoilerKlaar</i> = ja (zet hem op nee in F1, F2 en F4)',
                      'Gebruikt in F3: het element gaat pas aan als de warmtepomp klaar is, zodat het element alleen '
                      'boven de 53 °C verwarmt en de zuinige warmtepomp altijd eerst aan de beurt is.'),
           flow_block('F10', 'Bewaking',
                      'Weten wanneer een koppeling niet werkt.',
                      f'{H} Apparaat (Batterij of Lydos) is niet meer beschikbaar (kaartnaam verschilt per '
                      f'Homey-versie; anders via een community-app zoals Device Capabilities)',
                      '',
                      f'{H} Stuur pushbericht „[apparaat] niet bereikbaar”',
                      'De Lydos-app wordt na 3 mislukte pogingen (15 min) niet beschikbaar; Batterij Regeling na '
                      '5 pogingen (~30 s).'),

           H2('13.7 Instellingen die hierbij horen'),
           checklist('c137', [
               ('Lydos: app-versie 1.2.0 of nieuwer geïnstalleerd', 'Noteer versie'),
               ('Lydos: modus Green als uitgangspunt', 'i-Memory en Programma uitschakelen'),
               ('Lydos: ophaalinterval 5 min (niet lager dan 3)', 'Voorkomt blokkade door de Ariston-cloud'),
               ('Lydos: eigen tijdprogramma / nachtmodus gecontroleerd', 'Nachtmodus = stil; mag aan blijven'),
               ('Lydos: anti-legionellafunctie aan of Flow F9 actief', 'Noteer welke'),
               ('Batterij: strategie Dynamisch (of Zelfconsumptie bij vast contract)', ''),
               ('Batterij: gemiddeld avondverbruik zonder boiler ingesteld', 'Boiler warmt niet meer ’s avonds op'),
               ('Homey: variabele BoilerBuffer aangemaakt', ''),
               ('SolarEdge: realtime productie en dagopbrengst zichtbaar in Homey', 'Voor F1 en F7'),
               ('Stekker boiler: vermogen realtime zichtbaar, geschikt voor 16 A', 'Noteer merk/type'),
               ('Stekker boiler: wordt nooit uitgeschakeld door Flows (boiler via de Lydos-app sturen)', ''),
               ('Stekker batterij: aan/uit afgeschermd, geen Flows die hem uitschakelen', ''),
               ('Stekker batterij: uitgesloten van Homey Energy (geen dubbeltelling)', ''),
               ('Homey Energy: huisverbruik plausibel (zie 13.2)', 'Noteer verbruik vandaag'),
               ('Homey: variabele BoilerKlaar aangemaakt', 'Voor F3 en F12'),
           ]),

           H2('13.8 Tests voor de samenwerking'),
           test_block('T11', 'Boiler op zonne-overschot (F1/F2)',
                      'Controleren dat de boiler met zonnestroom opwarmt en de batterij het restant opneemt.',
                      ['Zonnige dag, batterij op Zelfconsumptie of Dynamisch, boiler Green op 45 °C.',
                       'Wacht tot het overschot 10 min boven 400 W is: F1 zet de boiler op 53 °C.',
                       'Kijk na 5–10 min (Lydos ververst elke 5 min) of „aan het opwarmen” aan staat.'],
                      'Doeltemperatuur 53 °C, boiler warmt op. Batterijvermogen daalt met ~190–220 W; P1 blijft '
                      'rond de doelwaarde. Na verdwijnen van het overschot zet F2 de boiler terug op 45 °C.',
                      ['Overschot vóór start boiler (W)', 'Batterij-laadvermogen vóór / na start (W)',
                       'Vermogen boiler-stekker, warmtepomp (W)', 'Opwarmtijd 45 → 53 °C (min)']),
           test_block('T12', 'Geen opwarmen in dure kwartieren (F5/F6)',
                      'Controleren dat de boiler ’s avonds niet via de batterij opwarmt, behalve voor comfort.',
                      ['Strategie Dynamisch; wacht op een planwissel naar Ontladen (avond).',
                       'Controleer de doeltemperatuur van de boiler.',
                       'Optioneel: tap warm water tot de douchebeurten onder 2 komen en kijk of F6 ingrijpt.'],
                      'Doeltemperatuur 45 °C, boiler warmt niet op. Bij te weinig douchebeurten warmt hij toch op.',
                      ['Tijdstip planwissel', 'Doeltemperatuur na wissel (°C)',
                       'Reactie F6 bij weinig douchebeurten (ja/nee)']),
           test_block('T13', 'Element bij groot overschot (F3)',
                      'Controleren dat het element alleen bij volle batterij en groot overschot wordt gebruikt.',
                      ['Zonnige dag, batterij ≥ 95 %, overschot > 1400 W.',
                       'Wacht 10 min: F3 zet de boiler op Boost / 60 °C.',
                       'Controleer dat de boiler na 90 min of via F2 terug op Green / 53 °C gaat.'],
                      'P1-teruglevering daalt met ~1200 W zolang het element aan staat. Geen afname van het net.',
                      ['Laadniveau batterij (%)', 'Overschot vóór / tijdens element (W)',
                       'Vermogen boiler-stekker, element (W)', 'Terug naar Green na (min)']),
           test_block('T14', 'Energiebalans en dubbeltellingen',
                      'Controleren dat alle meters met elkaar kloppen en Homey Energy niets dubbel telt.',
                      ['Kies een rustig moment zonder grote schakelende verbruikers.',
                       'Noteer tegelijk: P1, SolarEdge-productie, batterij (Homey en stekker), boiler-stekker.',
                       'Vergelijk de dagtotalen in Homey Energy met de P1 aan het eind van de dag.'],
                      'Batterij Regeling en de batterij-stekker verschillen minder dan ± 30 W (de stekker toont vaak '
                      'geen richting). Het huisverbruik in Homey Energy is plausibel en de batterij-stekker telt niet mee.',
                      ['P1 (W) / SolarEdge (W)', 'Batterij Homey / stekker (W)', 'Boiler-stekker (W)',
                       'Dagverbruik Homey Energy / P1 (kWh)']),
           remarks('c13', 60, 'Opmerkingen samenwerking'),
           PageBreak()]
    return out


# ---------------------------------------------------------------- content
def build():
    story = []

    # ---------- voorblad
    story += [P('<b>Installatiegegevens</b>', 'h2'), Spacer(1, 2),
              fields('voorblad', ['Naam / adres installatie', 'Datum installatie', 'Uitgevoerd door',
                                  'Serienummer Zendure (sn)', 'Firmwareversie Zendure',
                                  'Homey Pro model / firmware', 'Energieleverancier / contract',
                                  'Aantal AB3000L-uitbreidingen', 'Aansluiting (stopcontact / eigen groep)'],
                     label_w=66 * mm),
              Spacer(1, 10),
              P('Deze handleiding beschrijft de installatie, inbedrijfstelling en periodieke controle van de '
                'Homey-app <i>Batterij Regeling</i>. Alle grijs-omrande vakken zijn invulbaar: digitaal in een '
                'PDF-lezer (Adobe Reader, Edge, Foxit) of met pen na printen. Bewaar het ingevulde exemplaar '
                'bij de installatiedocumentatie.', 'small'),
              NextPageTemplate('normal'), PageBreak()]

    # ---------- inhoud
    toc = TableOfContents()
    toc.levelStyles = [S['toc1'], S['toc2']]
    story += [P('Inhoud', 'h1'), toc, PageBreak()]

    # ---------- 1 inleiding
    story += [H1('1. Inleiding'),
              P('<i>Batterij Regeling</i> is een Homey Pro-app die een Zendure SolarFlow 2400 AC+ volledig lokaal '
                'aanstuurt. Elke vijf seconden leest de app het netvermogen van de HomeWizard P1-meter en de '
                'toestand van de batterij, en bepaalt hij hoeveel de batterij moet laden of ontladen. Voor '
                'dynamische energiecontracten (zoals Zonneplan) haalt de app de kwartierprijzen van de '
                'day-ahead-markt op en maakt daarmee een laad- en ontlaadplan. Het idee is gebaseerd op het '
                'open-source project <i>Home Battery Control</i> voor Home Assistant, vertaald naar Homey.'),

              H2('1.1 Wat de app doet'),
              *bullets([
                  '<b>Nul op de meter (zelfconsumptie):</b> zonne-overschot gaat de batterij in, bij afname '
                  'levert de batterij precies wat het huis vraagt.',
                  '<b>Dynamische prijzen:</b> laden in de goedkoopste kwartieren, ontladen in de duurste, '
                  'en de batterij bewust vasthouden voor de avondpiek.',
                  '<b>Zeven strategieën:</b> uit, zelfconsumptie, alleen zon, dynamisch, geforceerd laden, '
                  'geforceerd ontladen en piekbegrenzing, te wisselen via de Homey-app of Flows.',
                  '<b>Zonverwachting:</b> niet uit het net laden als de zon de batterij de volgende dag vult '
                  '(forecast.solar).',
                  '<b>Opbrengst en rendement:</b> besparing in euro per dag en totaal, en het werkelijke rendement '
                  'dat de app zelf leert.',
                  '<b>Vangnet:</b> zonder P1-meting gaat de batterij binnen ~15 s naar stand-by.',
                  '<b>Homey-integratie:</b> Flow-kaarten, dashboardwidget, Insights-grafieken en weergave in Homey Energy als '
                  'thuisbatterij.',
              ]),

              H2('1.2 Waarom zelf aansturen en niet de Zendure-app?'),
              P('De Zendure-app is zelf ook slim. Met <b>ZENKI</b> (de AI-energiemanager van Zendure) '
                'ondersteunt de SolarFlow 2400 AC+ onder meer de HomeWizard P1-meter, meer dan 840 Europese '
                'energieleveranciers met dynamische tarieven, zonnevoorspelling en het leren van je '
                'verbruikspatroon. Wie alleen de batterij wil laten werken, is met de Zendure-app prima '
                'geholpen. Aansturen via Homey is vooral interessant als je de batterij onderdeel wilt maken '
                'van de rest van je slimme huis, en als je zelf controle wilt over wat er gebeurt.'),
              Spacer(1, 4),
              table([
                  ['Aspect', 'Zendure-app (ZENKI)', 'Batterij Regeling (Homey)'],
                  ['Waar beslist wordt', 'Via de Zendure-cloud en app', 'Lokaal op je Homey Pro, in je eigen netwerk'],
                  ['Zonder internet', 'Slimme functies en planning afhankelijk van de cloud',
                   'Nul-op-de-meter blijft werken; alleen nieuwe prijzen ontbreken'],
                  ['Snelheid regeling', 'Afhankelijk van meter en cloudverbinding',
                   'P1 direct lokaal uitgelezen, bijsturen elke 5 s (instelbaar vanaf 2 s)'],
                  ['Transparantie', 'AI-beslissingen, beperkt inzichtelijk',
                   'Plan per kwartier zichtbaar, vaste en uitlegbare regels, alle parameters instelbaar'],
                  ['Koppeling met andere apparaten', 'Beperkt tot het Zendure-ecosysteem',
                   'Via Flows koppelen aan laadpaal, warmtepomp, boiler, meldingen, enz.'],
                  ['Eigen strategieën', 'Vaste modi van Zendure',
                   'Piekbegrenzing, terugleveren op dure momenten, geforceerd laden/ontladen, schema\'s via Flows'],
                  ['Privacy', 'Verbruiksdata naar de cloud van de fabrikant',
                   'Verbruiksdata blijft thuis; alleen de publieke prijzen komen van internet'],
                  ['Afhankelijkheid', 'App- en cloudwijzigingen van Zendure',
                   'Lokale zenSDK-API van Zendure (officieel gedocumenteerd)'],
                  ['Slimheid', 'Leert verbruik, gebruikt weer- en zonnevoorspelling',
                   'Zonverwachting (forecast.solar) en geleerd rendement; verbruik als vaste instelling'],
                  ['Beheer', 'Door Zendure onderhouden', 'Zelf onderhouden; Homey moet blijven draaien'],
              ], [34 * mm, (CONTENT_W - 34 * mm) / 2, (CONTENT_W - 34 * mm) / 2]),
              Spacer(1, 6),
              P('<b>De belangrijkste voordelen op een rij</b>', 'h3'),
              *bullets([
                  '<b>Eén regie in huis.</b> De batterij weet wat de rest van het huis doet en andersom. '
                  'Bijvoorbeeld: laat de batterij niet ontladen zolang de auto laadt, of zet de boiler aan '
                  'als de geplande actie „laden (goedkoop)” is.',
                  '<b>Lokaal en robuust.</b> Een storing bij de fabrikant of internetprovider legt de '
                  'basisregeling niet stil.',
                  '<b>Uitlegbaar.</b> Je ziet per kwartier waarom de batterij laadt, ontlaadt of wacht, en kunt '
                  'de drempels zelf aanpassen.',
                  '<b>Geen extra hardware.</b> De HomeWizard P1 die je al hebt is voldoende; een Zendure '
                  'Smart Meter is niet nodig.',
              ]),
              callout('Laat nooit twee systemen tegelijk de batterij aansturen. Zet de slimme modi in de '
                      'Zendure-app uit zodra Batterij Regeling actief is (zie hoofdstuk 5), anders werken de '
                      'twee regelingen elkaar tegen.', 'warn'),

              H2('1.3 Wanneer levert het wat op?'),
              P('In Nederland loopt de salderingsregeling af per <b>1 januari 2027</b>. Daarna wordt '
                'teruggeleverde stroom veel minder waard dan stroom die je zelf gebruikt, en voeren '
                'leveranciers terugleverkosten in. Een batterij die zonnestroom opslaat voor eigen gebruik '
                'wordt dan duidelijk rendabeler. Met een dynamisch contract kun je daarnaast verdienen aan het '
                'prijsverschil tussen goedkope en dure kwartieren.'),
              P('<b>Indicatie</b> (geen garantie), op basis van de prijzen van 23 september 2026: goedkoopste '
                'kwartieren ca. € 0,07 en avondpiek ca. € 0,29 per kWh (marktprijs incl. btw). Met 2,4 kWh, '
                '90 % bruikbaar en 85 % rendement levert één cyclus ongeveer € 0,20 tot € 0,30 op, '
                'na energiebelasting over de verliezen. Op dagen met weinig prijsverschil laadt de app '
                'bewust niet uit het net. Met extra AB3000L-accu\'s schaalt de opbrengst mee.'),

              H2('1.4 Vergelijking met Home Battery Control'),
              P('De app is gebaseerd op de documentatie van <i>Home Battery Control</i> (docs.homebatterycontrol.com), '
                'een open-source regeling voor Home Assistant en Node-RED. Zo zijn de onderdelen vertaald:'),
              table([
                  ['Home Battery Control', 'Batterij Regeling (Homey)'],
                  ['Self-consumption (PID, Kp 0,5)', 'Zelfconsumptie (P-regeling op de batterijstand, versterking 0,7)'],
                  ['Charge PV', 'Alleen laden met zon'],
                  ['Zero import', 'Nul import (alleen ontladen)'],
                  ['Charge (tot doel) → vervolgstrategie', 'Geforceerd laden tot X % → vervolgstrategie'],
                  ['Sell (tot vloer) → vervolgstrategie', 'Geforceerd ontladen tot X % → vervolgstrategie'],
                  ['Dynamic: Low / Neutral / High met eigen actie', 'Dynamisch: goedkoop / neutraal / duur met eigen actie'],
                  ['Standby / peak shave', 'Stand-by / piekbegrenzing'],
                  ['Peak shaving bovenop elke strategie', 'Import- en exportgrens net (alle strategieën)'],
                  ['Full stop', 'Uit (stand-by)'],
                  ['Timed (5 tijdvensters)', 'Homey Flows met Datum &amp; tijd (onbeperkt aantal vensters)'],
                  ['EV stop trigger', 'Flow: laadpaal start → strategie wijzigen (hoofdstuk 10.2)'],
                  ['Solar forecast charge goal', 'Zonverwachting in het prijsplan (forecast.solar)'],
                  ['Hysteresis / stop after idle', 'Hysterese laden/ontladen, dode zone, minimaal vermogen'],
                  ['Dashboard', 'Widget + lokale webpagina (hoofdstuk 6b)'],
                  ['Per fase regelen (3-fase)', 'Niet nodig: de P1-meter saldeert over alle fases'],
              ], [70 * mm, CONTENT_W - 70 * mm]),
              Spacer(1, 4),
              P('<b>Verschil in het prijsplan:</b> Home Battery Control koppelt per dag de goedkoopste aan de duurste '
                'kwartieren; hun documentatie noemt zelf als beperking dat daarbij de volgorde in de tijd, de '
                'capaciteit van de batterij en onverwachte zon niet worden meegenomen. Batterij Regeling rekent '
                'met een energiesimulatie juist wél met die drie (hoofdstuk 2.3).'),
              PageBreak()]

    # ---------- 2 systeemoverzicht
    story += [H1('2. Systeemoverzicht'),
              system_diagram(),
              Spacer(1, 6),
              table([
                  ['Onderdeel', 'Functie', 'Verbinding'],
                  ['HomeWizard P1-meter', 'Meet netafname (+) en teruglevering (−) in watt',
                   'Lokale API v1: http://&lt;ip&gt;/api/v1/data'],
                  ['Homey Pro (2023)', 'Draait de app, berekent set-points en het prijsplan', 'Wifi/LAN'],
                  ['Zendure SolarFlow 2400 AC+', 'Laadt/ontlaadt op commando; meldt laadniveau en vermogen',
                   'zenSDK: http://&lt;ip&gt;/properties/report en /properties/write'],
                  ['EnergyZero API', 'Publieke EPEX-kwartierprijzen (dezelfde marktprijzen als Zonneplan)',
                   'Internet, elk half uur'],
              ], [42 * mm, 70 * mm, CONTENT_W - 112 * mm]),
              H2('2.1 Tekenafspraken'),
              table([
                  ['Grootheid', 'Positief (+)', 'Negatief (−)'],
                  ['Net (P1)', 'Afname van het net', 'Teruglevering aan het net'],
                  ['Batterijvermogen in Homey', 'Batterij laadt', 'Batterij ontlaadt'],
                  ['Intern set-point (logboek/status)', 'Ontladen naar huis', 'Laden'],
              ], [60 * mm, 55 * mm, CONTENT_W - 115 * mm]),
              H2('2.2 Regelprincipe'),
              P('Bij zelfconsumptie corrigeert de app het batterijvermogen met een deel (de <i>regelversterking</i>, '
                'standaard 0,7) van het verschil tussen de P1-meting en de <i>net-doelwaarde</i> (standaard +20 W, '
                'om teruglevering te voorkomen). Commando\'s worden alleen verstuurd als de wijziging groter is '
                'dan de <i>dode zone</i> (25 W), en minstens eens per minuut als bevestiging. Waarden worden met '
                '<font name="Arial-Bold">smartMode = 1</font> geschreven: ze gaan alleen naar het werkgeheugen, '
                'zodat het flashgeheugen van de Zendure niet slijt.'),
              P('<b>Vangnet:</b> lukt het 3 keer achter elkaar niet om de P1-meter uit te lezen (~15 s), dan zet '
                'de app de batterij op stand-by bij alle strategieën die de meter nodig hebben, en toont hij een '
                'waarschuwing bij het apparaat. Geforceerd laden/ontladen en laden in een goedkoop kwartier gaan '
                'door, want die hebben de meter niet nodig. Zodra de meter terug is, hervat de regeling vanzelf.'),
              P('<b>Meerdere batterijen:</b> koppel je een tweede Zendure, dan verdelen de apparaten de correctie '
                '(regelversterking, doelwaarde en piekdrempel worden door het aantal batterijen gedeeld), zodat ze '
                'niet samen doorschieten.'),
              H2('2.3 Het prijsplan (strategie Dynamisch)'),
              *bullets([
                  'Alle prijzen worden verhoogd met de <b>opslag</b> en <b>energiebelasting</b> uit de instellingen '
                  '(all-in prijs).',
                  'Ontladen loont als: prijs ≥ gemiddelde laadprijs ÷ rendement + minimale winst. Aaneengesloten '
                  'dure kwartieren vormen een <b>duur blok</b> (bijvoorbeeld de avondpiek).',
                  'Vóór elk duur blok zijn de goedkoopste kwartieren sinds het vorige blok <b>laadkandidaten</b>, '
                  'mits de rit heen en terug winst oplevert.',
                  'Tussen twee laadmomenten blijven alleen de <b>duurste</b> kwartieren die de batterij bij het '
                  'gemiddelde avondverbruik kan dekken op <b>ontladen</b>; de rest wordt <b>vasthouden</b>.',
                  '<b>Energiesimulatie:</b> de app loopt het plan in de tijd door, vanaf het huidige laadniveau, '
                  'telt de verwachte zon erbij en het verbruik in ontlaadkwartieren eraf. Alleen waar energie tekort '
                  'komt, wordt het goedkoopste eerdere én winstgevende laadkwartier ingeschakeld. Zo koopt de '
                  'batterij nooit stroom die de zon de volgende dag gratis levert, of die het plan niet gebruikt.',
                  'Per periode kies je wat de batterij doet (instellingen → Dynamische prijzen): <b>goedkoop</b> '
                  '(standaard laden uit het net), <b>neutraal</b> (standaard alleen laden met zon = vasthouden) en '
                  '<b>duur</b> (standaard zelfconsumptie; of verkopen = vol vermogen ontladen).',
                  'Bij vasthouden wordt zonne-overschot wel opgeslagen, maar niet ontladen. Negatieve prijzen '
                  'betekenen altijd laden.',
                  '<b>Prijsbronnen:</b> EnergyZero (kwartierprijzen); met een ENTSO-E-token als reserve als '
                  'EnergyZero niet bereikbaar is.',
              ]),
              PageBreak()]

    # ---------- 3 benodigdheden
    story += [H1('3. Benodigdheden en voorbereiding'),
              P('Controleer vóór de installatie of alles aanwezig is. Noteer versies en IP-adressen; deze heb je '
                'later nodig.'),
              checklist('c3', [
                  ('Homey Pro (2023 of nieuwer), firmware 12.3 of hoger', 'Nodig voor de dashboardwidget'),
                  ('Gegevens zonnepanelen: totaal piekvermogen (kWp), hellingshoek en richting', 'Voor de zonverwachting; zie SolarEdge-portaal'),
                  ('Locatie van Homey correct ingesteld', 'Homey → Instellingen → Locatie (voor de zonverwachting)'),
                  ('Zendure SolarFlow 2400 AC+ geïnstalleerd en werkend in de Zendure-app', ''),
                  ('Zendure-firmware bijgewerkt naar de nieuwste versie', 'Lokale API (zenSDK) vereist recente firmware'),
                  ('HomeWizard P1-meter aangesloten op de slimme meter', ''),
                  ('Lokale API ingeschakeld in HomeWizard Energy-app', 'Instellingen → Meters → P1 → Lokale API'),
                  ('Vast IP-adres (DHCP-reservering) voor de Zendure', 'Noteer IP-adres'),
                  ('Vast IP-adres (DHCP-reservering) voor de P1-meter', 'Noteer IP-adres'),
                  ('Homey, Zendure en P1 in hetzelfde netwerk/VLAN', 'Geen gastnetwerk / client-isolatie'),
                  ('Computer met Node.js en Homey CLI (npm i -g homey)', 'Alleen nodig voor installatie van de app'),
                  ('Dynamisch energiecontract actief (bijv. Zonneplan)', 'Alleen voor strategie Dynamisch'),
                  ('Opslag leverancier en energiebelasting opgezocht', 'Zie je jaarnota of het tarievenblad'),
              ]),
              Spacer(1, 8),
              remarks('c3'),
              PageBreak()]

    # ---------- 4 elektrisch & veiligheid
    story += [H1('4. Elektrische installatie en veiligheid'),
              P('De SolarFlow 2400 AC+ werkt standaard met 800 W via een gewoon stopcontact. Het volledige '
                'vermogen van 2400 W (ontladen) en tot 3200 W (laden) is alleen toegestaan op een eigen groep '
                'die door een erkend installateur is aangelegd. De app staat standaard op 800 W; verhoog dit '
                'pas nadat de installatie dat toelaat.'),
              callout('Stel in de app nooit een hoger maximaal laad- of ontlaadvermogen in dan de groep en de '
                      'installatie toelaten. De app bewaakt geen groepsbelasting.', 'warn'),
              checklist('c4', [
                  ('Aansluiting: gewoon stopcontact (max. 800 W) of eigen groep', 'Noteer type en groepnummer'),
                  ('Bij eigen groep: aangelegd door erkend installateur', 'Noteer installateur / datum'),
                  ('Aardlekschakelaar aanwezig op de betreffende groep', ''),
                  ('Zekeringwaarde van de groep', 'Noteer A'),
                  ('Geen andere zware verbruikers op dezelfde groep', ''),
                  ('Geen verlengsnoer of haspel gebruikt', ''),
                  ('Batterij aangemeld bij netbeheerder via energieleveren.nl', 'Verplicht bij teruglevering'),
                  ('Batterij staat droog, vorstvrij en geventileerd', 'Zie Zendure-handleiding'),
                  ('Maximaal laadvermogen dat de installatie toelaat', 'Noteer W → instelling in hfdst. 7'),
                  ('Maximaal ontlaadvermogen dat de installatie toelaat', 'Noteer W → instelling in hfdst. 7'),
              ]),
              Spacer(1, 8),
              remarks('c4'),
              PageBreak()]

    # ---------- 5 netwerk & zendure-app
    story += [H1('5. Netwerk en Zendure-app voorbereiden'),
              H2('5.1 Bereikbaarheid controleren'),
              P('Open vanaf een computer in hetzelfde netwerk onderstaande adressen in een browser. Beide moeten '
                'direct een JSON-tekst tonen.'),
              table([
                  ['Apparaat', 'Adres', 'Wat je moet zien'],
                  ['Zendure', 'http://&lt;zendure-ip&gt;/properties/report',
                   '"sn": "…", en onder "properties" o.a. "electricLevel" (laadniveau %)'],
                  ['HomeWizard P1', 'http://&lt;p1-ip&gt;/api/v1/data', '"active_power_w": … (netvermogen in W)'],
              ], [28 * mm, 62 * mm, CONTENT_W - 90 * mm]),
              Spacer(1, 6),
              fields('c51', ['IP-adres Zendure', 'Serienummer (sn) uit report', 'electricLevel (laadniveau %)',
                             'IP-adres P1-meter', 'active_power_w op dat moment (W)',
                             'Ping Zendure vanaf computer (ms)']),
              H2('5.2 Zendure-app instellen'),
              P('Batterij Regeling moet de enige regelaar zijn. Pas daarom in de Zendure-app het volgende aan '
                '(de namen van menu\'s kunnen per app-versie iets verschillen):'),
              checklist('c52', [
                  ('ZENKI / AI-modus uitgeschakeld', 'Geen automatische planning door Zendure'),
                  ('Koppeling met smart meter (Smart Matching / P1 / 3CT) in de Zendure-app uitgeschakeld',
                   'De HomeWizard P1 blijft gewoon werken voor Homey'),
                  ('Geen tijdschema\'s of dynamische-tarief-instellingen actief in de Zendure-app', ''),
                  ('Minimaal laadniveau (ontlaadgrens) in Zendure-app ingesteld als vangnet', 'Noteer %'),
                  ('Maximaal laadniveau (laadgrens) in Zendure-app ingesteld als vangnet', 'Noteer %'),
                  ('Wifi-signaal van de Zendure voldoende (of LAN-kabel gebruikt)', 'Noteer RSSI / verbinding'),
              ]),
              callout('De laadgrenzen in de Zendure-app zijn een vangnet: als Homey onverwacht stopt, voorkomen '
                      'ze diepontlading of onnodig volladen. Houd ze gelijk aan, of iets ruimer dan, de '
                      'instellingen in Batterij Regeling.'),
              H2('5.3 Optioneel: HomeWizard API v2'),
              P('De app gebruikt standaard de lokale API v1 van de P1-meter. De nieuwere, beveiligde API v2 kan ook: '
                'vink bij het koppelen „Ik gebruik HomeWizard API v2” aan, open daarna het apparaat → '
                '<i>Repareren</i> → <i>Start</i>, en druk binnen 60 seconden kort op de knop van de P1-meter. De app '
                'haalt een token op, test de verbinding en slaat het token op.'),
              fields('c53', ['API-versie in gebruik (v1 / v2)', 'Datum token opgehaald']),
              remarks('c5', 44),
              PageBreak()]

    # ---------- 6 installatie app
    story += [H1('6. De Homey-app installeren'),
              P('De app is (nog) niet in de Homey App Store gepubliceerd en wordt met de Homey CLI vanaf een '
                'computer geïnstalleerd.'),
              table([
                  ['Stap', 'Actie / commando'],
                  ['1', 'Open een terminal in de projectmap <font name="Arial-Bold">Homey\\Batterij</font>.'],
                  ['2', '<font name="Arial-Bold">homey login</font>: inloggen met je Athom-account.'],
                  ['3', '<font name="Arial-Bold">homey select</font>: kies de juiste Homey Pro.'],
                  ['4', '<font name="Arial-Bold">homey app validate</font>: moet eindigen met '
                        '„App validated successfully”.'],
                  ['5', '<font name="Arial-Bold">homey app install</font>: installeert de app permanent. '
                        '(Of <font name="Arial-Bold">homey app run</font> om live logs te zien tijdens het testen; de '
                        'app stopt dan als je de terminal sluit.)'],
                  ['6', 'Homey-app → <i>Apparaat toevoegen</i> → <i>Batterij Regeling</i> → '
                        '<i>Zendure SolarFlow (geregeld)</i>.'],
                  ['7', '<i>Zoek in mijn netwerk</i> (10–20 s) vult de IP-adressen automatisch in; of vul ze zelf '
                        'in → <i>Verbinden</i>. De app controleert beide verbindingen voordat het apparaat wordt '
                        'aangemaakt.'],
                  ['8', 'Dashboard: Homey → Dashboard → bewerken → widget <i>Batterijplan</i> toevoegen. Die toont '
                        'laadniveau, status, opbrengst vandaag en het plan per kwartier (groen = laden, oranje = '
                        'ontladen, grijs = vasthouden).'],
              ], [14 * mm, CONTENT_W - 14 * mm]),
              Spacer(1, 8),
              checklist('c6', [
                  ('homey app validate zonder fouten', 'Noteer datum'),
                  ('App geïnstalleerd, versie zichtbaar in Homey → Apps', 'Noteer versie'),
                  ('Apparaat gekoppeld zonder foutmelding', ''),
                  ('Apparaatnaam bevat productnaam van de Zendure', 'Noteer naam'),
                  ('Status-tegel toont binnen 10 s een waarde (bijv. „Stand-by · …”)', ''),
                  ('Laadniveau in Homey gelijk aan Zendure-app (± 1 %)', 'Noteer beide waarden'),
                  ('Net (P1) in Homey gelijk aan HomeWizard-app (± 50 W)', 'Noteer beide waarden'),
                  ('Stroomprijs zichtbaar (all-in, €/kWh)', 'Noteer prijs'),
                  ('Netwerkscan vond Zendure en P1 (of handmatig ingevuld)', 'Noteer wat gevonden werd'),
                  ('Widget Batterijplan op het dashboard toont het plan', ''),
              ]),
              remarks('c6', 44),
              PageBreak(),

              H1('6a. Proefperiode in demo-modus'),
              P('Een nieuw gekoppelde batterij staat standaard in <b>demo-modus</b>. De app leest dan alles uit '
                'en rekent alles door (prijsplan, gewenst vermogen, zonne-overschot, opbrengst), maar stuurt '
                '<b>nooit</b> een opdracht naar de Zendure: niet tijdens de regeling, niet bij P1-uitval en niet bij '
                'het stoppen van de app. De batterij blijft werken met zijn eigen programma uit de Zendure-app.'),
              P('De <b>boiler</b> blijft ook op zijn eigen programma. De Lydos-app zelf heeft geen demostand; in '
                'plaats daarvan krijgt elke Flow die de boiler aanstuurt (hoofdstuk 13) de voorwaarde '
                '<font color="#1F8A4C"><b>[Batterij]</b></font> <i>Demo-modus staat uit</i>. Zolang de demo-modus '
                'aan staat, doen die Flows dus niets. Wil je zien wat ze zouden doen, voeg dan tijdelijk een '
                'tweede Flow toe met dezelfde trigger, de voorwaarde <i>Demo-modus staat aan</i> en als actie een '
                'melding of een regel in de tijdlijn.'),
              table([
                  ['Wat', 'In demo-modus', 'Na uitzetten demo-modus'],
                  ['Batterij', 'Eigen programma (Zendure-app / ZENKI)', 'Batterij Regeling stuurt'],
                  ['Boiler', 'Eigen programma; boiler-Flows doen niets', 'Boiler-Flows uit hoofdstuk 13 actief'],
                  ['Status-tegel', '„Demo – zou: laden 800 W · …”', '„Laden 800 W · …”'],
                  ['Gewenst batterijvermogen', 'Wat de app zou sturen', 'Wat de app stuurt'],
                  ['Opbrengst vandaag/totaal', 'Opbrengst van het eigen Zendure-programma',
                   'Opbrengst van Batterij Regeling'],
                  ['Widget', 'Oranje label DEMO', 'Geen label'],
              ], [40 * mm, 62 * mm, CONTENT_W - 102 * mm]),
              Spacer(1, 4),
              P('<b>Handige vergelijking:</b> in Insights zie je <i>Batterijvermogen</i> (wat de Zendure met zijn '
                'eigen programma doet) naast <i>Gewenst batterijvermogen</i> (wat Batterij Regeling zou doen). En de '
                'opbrengst van de demoperiode is een nulmeting: die vergelijk je later met de opbrengst als Batterij '
                'Regeling stuurt.'),
              callout('Tijdens de demoperiode laat je de Zendure-app zoals hij nu is ingesteld (ZENKI / slimme meter '
                      'mag aan blijven). Pas bij het uitzetten van de demo-modus voer je hoofdstuk 5.2 uit. Wil je '
                      'later terug naar demo, zet dan ook het programma in de Zendure-app weer aan.', 'warn'),
              H2('6a.1 Welke controles kunnen in demo-modus?'),
              table([
                  ['Kan in demo', 'Pas na uitzetten demo-modus'],
                  ['T1 communicatie · T7 prijsplan · T10 Homey Energy · T14 energiebalans · T15 zonverwachting · '
                   'T16 opbrengst en widget', 'T2–T6 (laden, ontladen, nul op de meter, zon, laadgrenzen) · T8 Flows · '
                   'T9 uitval · T11–T13 boiler'],
              ], [(CONTENT_W) / 2, (CONTENT_W) / 2]),
              H2('6a.2 Dagelijkse controle tijdens de proefperiode'),
              P('Noteer een paar dagen lang op een willekeurig moment de waarden naast elkaar. Kloppen ze '
                'steeds, dan kan de demo-modus uit.', 'small'),
              table([['Datum / tijd', 'Laadniveau Homey / Zendure-app', 'Net Homey / HomeWizard',
                      'Prijs Homey / Zonneplan', 'Gewenst / werkelijk (W)', 'Opmerking']] +
                    [[TextField(22 * mm, 16, name=f'demo_{i}_d'), TextField(26 * mm, 16, name=f'demo_{i}_s'),
                      TextField(26 * mm, 16, name=f'demo_{i}_n'), TextField(26 * mm, 16, name=f'demo_{i}_p'),
                      TextField(24 * mm, 16, name=f'demo_{i}_w'),
                      TextField(CONTENT_W - 152 * mm, 16, name=f'demo_{i}_o')] for i in range(10)],
                    [26 * mm, 30 * mm, 30 * mm, 30 * mm, 28 * mm, CONTENT_W - 144 * mm], zebra=False),
              Spacer(1, 8),
              checklist('c6a', [
                  ('Status-tegel toont „Demo – zou: …” en de widget het label DEMO', ''),
                  ('Batterij volgt aantoonbaar zijn eigen programma (Zendure-app)', ''),
                  ('Laadniveau, net en prijs kwamen alle dagen overeen (zie tabel)', ''),
                  ('Gewenst batterijvermogen is logisch (ontladen bij afname, laden bij teruglevering)', ''),
                  ('Boiler-Flows hebben de voorwaarde „Demo-modus staat uit”', ''),
                  ('Opbrengst eigen Zendure-programma genoteerd (nulmeting)', 'Noteer € per dag'),
                  ('Demo-modus uitgezet (instelling of Flow-kaart) en hoofdstuk 5.2 uitgevoerd', 'Noteer datum'),
              ]),
              PageBreak(),

              H1('6b. Webpagina in het thuisnetwerk'),
              P('De app heeft een eigen webpagina met alle gegevens en instellingen. Open op een pc, telefoon of '
                'tablet in je thuisnetwerk: <b>http://&lt;IP-adres van je Homey&gt;:8480</b>. Het IP-adres van je Homey '
                'vind je in de Homey-app → Instellingen → Algemeen, of in je router.'),
              table([
                  ['Onderdeel', 'Wat je ziet / kunt doen'],
                  ['Kopregel', 'Naam, DEMO-label, tijd van de laatste update (elke 5 s)'],
                  ['Tegels', 'Laadniveau, batterijvermogen, gewenst vermogen, net (P1), zonne-overschot, prijs, '
                   'opbrengst, geladen/ontladen, geleerd rendement, zonverwachting'],
                  ['Plan komende 24 uur', 'Prijs per kwartier in de kleur van de geplande actie, ontlaaddrempel, en de '
                   'eerstvolgende laad- en ontlaadmomenten (houd de muis op een balk voor details)'],
                  ['Bediening', 'Strategie wijzigen (met pincode)'],
                  ['Instellingen', 'Alle instellingen van de batterij, per groep; wijzigen en opslaan met pincode. '
                   'Tokens en pincode worden nooit getoond'],
              ], [40 * mm, CONTENT_W - 40 * mm]),
              Spacer(1, 4),
              P('<b>Beveiliging:</b> de pagina antwoordt alleen op apparaten in het thuisnetwerk (privé-IP-adressen). '
                'Wijzigen kan pas als je in Homey een pincode van 4–8 cijfers hebt ingesteld (apparaat → '
                'instellingen → Webpagina); zonder pincode is de pagina alleen-lezen. Na 5 foute pogingen is '
                'wijzigen 10 minuten geblokkeerd. Zet de poort nooit open in je router.'),
              checklist('c6b', [
                  ('Webpagina opent op http://&lt;homey-ip&gt;:8480', 'Noteer adres'),
                  ('Waarden op de webpagina gelijk aan de Homey-app', ''),
                  ('Pincode ingesteld (of bewust alleen-lezen gelaten)', ''),
                  ('Test: een instelling wijzigen via de webpagina komt door in Homey', ''),
                  ('Bladwijzer / snelkoppeling gemaakt op telefoon of tablet', ''),
              ]),
              PageBreak()]

    # ---------- 7 instellingen
    set_rows = [['Instelling', 'Standaard', 'Advies / toelichting', 'Ingesteld']]

    def srow(name, default, advice):
        TextField._n += 0
        set_rows.append([P(f'<b>{name}</b>', 'cell'), default, advice,
                         TextField(24 * mm, 16, name=f'inst_{len(set_rows)}')])

    for group, rows in [
        ('Modus', [
            ('Demo-modus (alleen uitlezen)', 'aan', 'Uitzetten na de proefperiode (hfdst. 6a)'),
        ]),
        ('Verbinding', [
            ('Zendure IP-adres', '—', 'Vast IP; wijzigen kan hier zonder opnieuw koppelen'),
            ('HomeWizard P1 IP-adres', '—', 'Vast IP'),
            ('HomeWizard API v2-token', 'leeg', 'Optioneel; ophalen via Repareren (hfdst. 5.3)'),
            ('Regelinterval', '5 s', '3–10 s. Korter reageert sneller, maar belast het netwerk meer'),
        ]),
        ('Batterij', [
            ('Capaciteit', '2,4 kWh', '2,4 kWh ingebouwd + 2,88 kWh per AB3000L'),
            ('Max laadvermogen', '800 W', 'Stopcontact 800 W; eigen groep tot 3200 W (zie hfdst. 4)'),
            ('Max ontlaadvermogen', '800 W', 'Stopcontact 800 W; eigen groep tot 2400 W'),
            ('Minimaal laadniveau', '10 %', 'Reserve; niet lager dan het vangnet in de Zendure-app'),
            ('Maximaal laadniveau', '100 %', '90–95 % kan de levensduur iets verlengen'),
            ('Rendement', '85 %', 'Startwaarde; zie ook geleerd rendement'),
            ('Geleerd rendement gebruiken', 'aan', 'Vervangt het rendement zodra er 5 kWh is geladen'),
        ]),
        ('Regeling', [
            ('Net-doelwaarde', '20 W', '0–30 W. Positief voorkomt teruglevering'),
            ('Regelversterking', '0,7', 'Pendelen → lager (0,5); traag → hoger (0,9)'),
            ('Dode zone', '25 W', 'Voorkomt onnodige commando\'s'),
            ('Minimaal vermogen', '30 W', 'Kleinere set-points worden 0'),
            ('Vermogen geforceerd laden', '800 W', 'Voor strategie Geforceerd laden'),
            ('Vermogen geforceerd ontladen', '800 W', 'Voor strategie Geforceerd ontladen'),
            ('Importgrens bij Stand-by / piek', '2500 W', 'Alleen voor strategie Stand-by / piekbegrenzing'),
            ('Geforceerd laden tot', '100 %', 'Daarna de vervolgstrategie'),
            ('Geforceerd ontladen tot', '20 %', 'Daarna de vervolgstrategie; niet lager dan het minimum'),
            ('Vervolgstrategie', 'Zelfcons.', 'Na het bereiken van het laad- of ontlaaddoel'),
            ('Importgrens net (alle)', '0 = uit', 'Piekbegrenzing bovenop elke strategie'),
            ('Exportgrens net (alle)', '0 = uit', 'Extra laden bij hoge teruglevering (terugleverkosten)'),
            ('Hysterese laden/ontladen', '0 W', '100–200 W vermindert relaisslijtage bij omschakelen'),
        ]),
        ('Dynamische prijzen', [
            ('Opslag leverancier incl. btw', '€ 0,020', 'Zonneplan: inkoopvergoeding per kWh'),
            ('Energiebelasting incl. btw', '€ 0,110', 'Zie jaarnota; telt mee in de verliezen'),
            ('Minimale winst per kWh', '€ 0,050', 'Hoger = minder, maar lucratievere cycli'),
            ('Gemiddeld avondverbruik', '500 W', 'Bepaalt hoe lang een volle batterij meegaat'),
            ('Goedkope periodes', 'Laden net', 'Of: alleen zon, zelfconsumptie, stand-by'),
            ('Neutrale periodes', 'Alleen zon', 'Of: zelfconsumptie, nul import, stand-by'),
            ('Dure periodes', 'Zelfcons.', 'Of: nul import, verkopen (vol vermogen), alleen zon, stand-by'),
            ('ENTSO-E-token', 'leeg', 'Optioneel reserveprijsbron; gratis via transparency.entsoe.eu'),
        ]),
        ('Zonverwachting', [
            ('Zonverwachting gebruiken', 'uit', 'Aan zodra de panelgegevens hieronder kloppen'),
            ('Piekvermogen zonnepanelen', '0 kWp', 'Aantal panelen × Wp; bijv. 12 × 400 Wp = 4,8 kWp'),
            ('Hellingshoek panelen', '35°', '0 = plat, 90 = verticaal'),
            ('Richting panelen', '0°', '0 = zuid, −90 = oost, 90 = west; bij oost-west: gemiddelde of 0'),
            ('Gemiddeld verbruik overdag', '400 W', 'Gaat van de zonverwachting af; de rest vult de batterij'),
        ]),
        ('Webpagina', [
            ('Webpagina in thuisnetwerk', 'aan', 'http://&lt;homey-ip&gt;:&lt;poort&gt;'),
            ('Poort', '8480', '1024–65535; niet openzetten in de router'),
            ('Pincode voor wijzigen', 'leeg', '4–8 cijfers; leeg = alleen-lezen'),
        ]),
    ]:
        set_rows.append([P(f'<font color="#1F8A4C"><b>{group}</b></font>', 'cell'), '', '', ''])
        for r in rows:
            srow(*r)
    st = table(set_rows, [44 * mm, 20 * mm, CONTENT_W - 64 * mm - 28 * mm, 28 * mm], zebra=False)
    story += [H1('7. Instellingen'),
              P('Open in Homey het apparaat → tandwiel (Instellingen). Noteer in de laatste kolom wat je hebt '
                'ingesteld. Wijzigingen zijn direct actief; het prijsplan wordt binnen een minuut herberekend. '
                'Bij elke instelling staat in Homey een info-icoontje en op de webpagina een <b>?</b> met een '
                'korte uitleg.'),
              st,
              PageBreak()]

    # ---------- 8 inbedrijfstelling (tests)
    story += [H1('8. Inbedrijfstelling: functionele tests'),
              P('Voer de tests in volgorde uit. Gebruik de HomeWizard Energy-app (P1), de Zendure-app en de '
                'apparaatpagina in Homey naast elkaar. Tip: met <font name="Arial-Bold">homey app run</font> zie je '
                'tijdens het testen ook de logregels van de app. Zet na elke test de strategie terug op '
                '<i>Uit</i>, tenzij anders vermeld.'),
              callout('T2 t/m T6, T8 en T9 werken alleen met de demo-modus <b>uit</b>; de andere tests kunnen al '
                      'tijdens de proefperiode (hoofdstuk 6a).', 'warn'),
              callout('Voer T2 en T3 uit bij een laadniveau tussen 30 % en 80 %, zodat laad- en ontlaadgrenzen '
                      'de test niet beïnvloeden.'),
              test_block('T1', 'Communicatie en uitlezing',
                         'Controleren dat Homey de Zendure en de P1-meter continu uitleest.',
                         ['Zet strategie op <i>Uit</i>.', 'Kijk 1 minuut naar de apparaatpagina in Homey.',
                          'Vergelijk laadniveau en netvermogen met de Zendure- en HomeWizard-app.'],
                         'Waarden verversen elke ~5 s. Laadniveau ± 1 %, net ± 50 W gelijk. Status „Stand-by · off”.',
                         ['Laadniveau Homey / Zendure-app (%)', 'Net Homey / HomeWizard (W)',
                          'Verversingsinterval waargenomen (s)']),
              test_block('T2', 'Geforceerd laden en tekenconventie',
                         'Controleren dat het laadcommando aankomt en de tekens kloppen.',
                         ['Noteer het netvermogen (P1) in rust.', 'Zet strategie op <i>Geforceerd laden</i> '
                          '(standaard 800 W; tijdelijk 300 W instellen mag ook).', 'Wacht 30 s.'],
                         'Batterijvermogen in Homey positief (≈ ingesteld vermogen). P1-afname stijgt met ongeveer '
                         'hetzelfde vermogen. Zendure-app toont „laden”. Status „Laden … W”.',
                         ['P1 vóór test (W)', 'P1 tijdens laden (W)', 'Batterij in Homey / tussenstekker (W)',
                          'Reactietijd tot laden begint (s)']),
              test_block('T3', 'Geforceerd ontladen',
                         'Controleren dat het ontlaadcommando aankomt.',
                         ['Zorg voor wat verbruik in huis (> 300 W).', 'Zet strategie op <i>Geforceerd ontladen</i>.',
                          'Wacht 30 s.'],
                         'Batterijvermogen in Homey negatief. P1-afname daalt met ongeveer het ingestelde vermogen.',
                         ['P1 vóór test (W)', 'P1 tijdens ontladen (W)', 'Batterij in Homey / tussenstekker (W)',
                          'Reactietijd (s)']),
              test_block('T4', 'Zelfconsumptie: nul op de meter',
                         'Controleren dat de regeling het netvermogen naar de doelwaarde stuurt, zonder pendelen.',
                         ['Zet strategie op <i>Zelfconsumptie</i>.', 'Wacht tot de P1-waarde stabiel is.',
                          'Zet een waterkoker of ander verbruik (1–2 kW) aan en weer uit.',
                          'Noteer hoe snel de P1-waarde terugkeert naar de doelwaarde.'],
                         'P1 stabiliseert rond de net-doelwaarde (± 30 W) binnen ± 20 s. Geen blijvend op-en-neer '
                         'gaan van het batterijvermogen. Boven het max ontlaadvermogen blijft er afname over.',
                         ['P1 stabiel in rust (W)', 'Insteltijd na inschakelen verbruik (s)',
                          'Insteltijd na uitschakelen verbruik (s)', 'Pendelen waargenomen? (ja/nee, amplitude W)']),
              test_block('T5', 'Opladen met zonne-overschot',
                         'Controleren dat zonne-overschot in de batterij gaat (bij zon, overdag).',
                         ['Zet strategie op <i>Alleen laden met zon</i> (of Zelfconsumptie).',
                          'Wacht tot er zonne-overschot is (P1 negatief zonder batterij).'],
                         'Batterij laadt met ongeveer het overschot; P1 blijft rond de doelwaarde. Bij '
                         '<i>Alleen zon</i> ontlaadt de batterij nooit.',
                         ['Zonne-opbrengst op dat moment (W)', 'Batterijvermogen (W)', 'P1 (W)']),
              test_block('T6', 'Laadgrenzen',
                         'Controleren dat de minimale en maximale laadniveaus worden gerespecteerd.',
                         ['Stel tijdelijk het minimaal laadniveau in op 1 % boven het actuele laadniveau.',
                          'Zet strategie op <i>Geforceerd ontladen</i>.',
                          'Zet het minimaal laadniveau daarna terug.'],
                         'De batterij stopt met ontladen zodra de grens is bereikt; status toont „(leeg)”. '
                         'Hetzelfde geldt voor laden en „(vol)”.',
                         ['Actueel laadniveau (%)', 'Tijdelijke grens (%)', 'Gedrag bij bereiken grens']),
              test_block('T7', 'Dynamisch prijsplan',
                         'Controleren dat de prijzen kloppen en het plan logisch is.',
                         ['Vergelijk de stroomprijs in Homey met de Zonneplan-app (zelfde kwartier).',
                          'Zet strategie op <i>Dynamisch</i>.', 'Bekijk de tegel „Geplande actie” en de status.',
                          'Optioneel op de computer: <font name="Arial-Bold">node test/planner.test.js</font> '
                          'toont het plan per uur.'],
                         'Het prijsverschil met Zonneplan is gelijk aan de verschillen in opslag en belasting. '
                         'Laden in de goedkoopste kwartieren, ontladen in de avondpiek, anders vasthouden.',
                         ['Prijs Homey / Zonneplan (€/kWh)', 'Geplande actie nu', 'Eerstvolgende laadmoment',
                          'Eerstvolgende ontlaadmoment']),
              test_block('T8', 'Flows',
                         'Controleren dat de Flow-kaarten werken.',
                         ['Maak een Flow: <i>Als</i> geplande actie is veranderd → <i>Dan</i> stuur een '
                          'melding met de tokens Actie en Prijs.',
                          'Maak een Flow die met „Strategie instellen” wisselt en test deze.'],
                         'Melding komt bij de volgende planwissel. Strategie wisselt direct en de batterij volgt '
                         'binnen één regelinterval.',
                         ['Getest: strategie instellen (ok/nok)', 'Getest: melding bij planwissel (ok/nok)',
                          'Getest: voorwaarde „prijs is lager dan” (ok/nok)']),
              test_block('T9', 'Uitval en herstel',
                         'Weten wat de batterij doet als Homey, de P1 of het netwerk wegvalt.',
                         ['Zet strategie op <i>Zelfconsumptie</i> met de batterij aan het ontladen.',
                          'Schakel de app uit (Homey → Apps → Batterij Regeling → uitschakelen) en observeer 5 min.',
                          'Schakel de app weer in. Herhaal met de P1-meter tijdelijk zonder stroom/wifi.',
                          'Herstart Homey en controleer dat de regeling vanzelf hervat.'],
                         'Bij uitschakelen van de app gaat de batterij naar stand-by (0 W). Bij P1-uitval gaat de '
                         'batterij na ~15 s naar stand-by met de waarschuwing „HomeWizard P1 niet bereikbaar”; zodra '
                         'de P1 terug is verdwijnt de waarschuwing en hervat de regeling. Na een herstart hervat de '
                         'regeling binnen 1 min.',
                         ['Gedrag batterij na uitschakelen app', 'Gedrag bij P1-uitval (vermogen / duur)',
                          'Tijd tot herstel na herstart Homey (s)']),
              test_block('T10', 'Homey Energy',
                         'Controleren dat de batterij correct in Homey Energy verschijnt.',
                         ['Open Homey → Energie.', 'Vergelijk laden/ontladen met de Zendure-app.'],
                         'Batterij zichtbaar als thuisbatterij. Laden en ontladen worden met het juiste teken '
                         'getoond; de kWh-tellers Geladen/Ontladen lopen op.',
                         ['Teken correct? (ja/nee)', 'Geladen / Ontladen kWh na 1 dag']),
              test_block('T15', 'Zonverwachting en plan',
                         'Controleren dat de zonverwachting klopt en dat de app op zonnige dagen niet uit het net laadt.',
                         ['Vul de panelgegevens in en zet de zonverwachting aan.',
                          'Vergelijk „Zonverwachting vandaag” aan het eind van de dag met de dagopbrengst van SolarEdge.',
                          'Kijk de avond vóór een zonnige dag in de widget: zijn er ’s nachts laadkwartieren?'],
                         'Verwachting en werkelijke opbrengst liggen binnen ± 30 % (bewolking maakt het onzeker). Voor '
                         'een zonnige dag plant de app ’s nachts alleen laden voor de ochtendpiek, niet voor de avond.',
                         ['Verwacht / werkelijk vandaag (kWh)', 'Laadkwartieren ’s nachts vóór zonnige dag',
                          'Laadkwartieren ’s nachts vóór bewolkte dag']),
              test_block('T16', 'Opbrengst, rendement en widget',
                         'Controleren dat opbrengst en rendement plausibel zijn.',
                         ['Noteer na één dag „Opbrengst vandaag”.',
                          'Controleer na twee weken „Geleerd rendement”.',
                          'Controleer dat de widget ververst (elke minuut).'],
                         'Opbrengst vandaag is ongeveer ontladen kWh × dure prijs − geladen kWh × goedkope prijs. Het '
                         'geleerde rendement ligt tussen 80 en 92 %.',
                         ['Opbrengst na 1 dag (€)', 'Geleerd rendement na 2 weken (%)', 'Widget ververst? (ja/nee)']),
              PageBreak()]

    # ---------- 9 afregelen
    story += [H1('9. Afregelen en optimaliseren'),
              P('De standaardwaarden werken in de meeste situaties. Gebruik onderstaande tabel als de regeling '
                'niet naar wens reageert. Wijzig één instelling tegelijk en herhaal test T4.'),
              table([
                  ['Symptoom', 'Oorzaak', 'Aanpassing'],
                  ['Batterijvermogen gaat steeds op en neer (pendelen)', 'Regeling te agressief t.o.v. reactietijd',
                   'Regelversterking omlaag (0,5) of regelinterval omhoog (7–10 s)'],
                  ['Traag bijsturen na een verbruiksstap', 'Regeling te voorzichtig',
                   'Regelversterking omhoog (0,9); interval omlaag (3 s)'],
                  ['Steeds kleine teruglevering', 'Doelwaarde te laag',
                   'Net-doelwaarde verhogen (30–50 W)'],
                  ['Steeds kleine afname (± 50 W) die niet wordt weggeregeld', 'Dode zone / minimaal vermogen',
                   'Dode zone of minimaal vermogen verlagen'],
                  ['Batterij leeg vóór de duurste uren', 'Avondverbruik te laag ingeschat',
                   'Gemiddeld avondverbruik verhogen'],
                  ['Batterij nog vol na de avondpiek', 'Avondverbruik te hoog ingeschat of winstdrempel te hoog',
                   'Gemiddeld avondverbruik of minimale winst verlagen'],
                  ['Laadt uit het net op dagen met weinig verschil', 'Winstdrempel te laag',
                   'Minimale winst per kWh verhogen'],
                  ['Laadt niet uit het net terwijl er goedkope uren zijn', 'Winstdrempel te hoog of batterij al vol',
                   'Minimale winst verlagen; laadniveau controleren'],
                  ['Batterij wisselt vaak tussen laden en ontladen', 'Verbruik schommelt rond nul',
                   'Hysterese laden/ontladen op 100–200 W zetten'],
              ], [52 * mm, 50 * mm, CONTENT_W - 102 * mm]),
              H2('9.1 Logboek afregeling'),
              table([['Datum', 'Gewijzigde instelling', 'Oud → nieuw', 'Effect']] +
                    [[TextField(22 * mm, 16, name=f'afr_{i}_d'), TextField(50 * mm, 16, name=f'afr_{i}_i'),
                      TextField(34 * mm, 16, name=f'afr_{i}_w'),
                      TextField(CONTENT_W - 128 * mm, 16, name=f'afr_{i}_e')] for i in range(8)],
                    [26 * mm, 54 * mm, 38 * mm, CONTENT_W - 118 * mm], zebra=False),
              PageBreak()]

    # ---------- 10 strategieen & flows
    story += [H1('10. Strategieën en Flow-voorbeelden'),
              table([
                  ['Strategie', 'Gedrag', 'Geschikt voor'],
                  ['Uit (stand-by)', 'Batterij doet niets', 'Onderhoud, afwezigheid'],
                  ['Zelfconsumptie', 'Nul op de meter: laden bij overschot, ontladen bij afname',
                   'Vast contract of na einde saldering'],
                  ['Alleen laden met zon', 'Laadt van overschot, ontlaadt nooit', 'Sparen voor later / voor een Flow'],
                  ['Nul import', 'Ontlaadt om afname te voorkomen, laadt nooit; zon gaat naar het net',
                   'Batterij leegmaken voor een zonnige dag'],
                  ['Dynamische prijzen', 'Per periode (goedkoop / neutraal / duur) een instelbare actie',
                   'Dynamisch contract (Zonneplan)'],
                  ['Geforceerd laden', 'Laadt met vast vermogen tot het laaddoel, dan vervolgstrategie',
                   'Handmatig of via Flow (bijv. storm op komst)'],
                  ['Geforceerd ontladen', 'Ontlaadt met vast vermogen tot het ontlaaddoel, dan vervolgstrategie',
                   'Verkopen bij een uitschieter in de prijs'],
                  ['Stand-by / piekbegrenzing', 'Doet niets, behalve als afname of teruglevering boven de grens komt',
                   'Capaciteitstarief, laadpaal, inductie'],
              ], [38 * mm, 78 * mm, CONTENT_W - 116 * mm]),
              H2('10.1 Beschikbare Flow-kaarten'),
              table([
                  ['Type', 'Kaart'],
                  ['Als (trigger)', 'Geplande actie is veranderd (tokens: actie, prijs) · Strategie is veranderd · '
                   'Zonne-overschot is Y minuten boven/onder X W · Demo-modus is veranderd'],
                  ['En (voorwaarde)', 'Strategie is (niet) … · Geplande actie is (niet) … · Prijs is lager/hoger dan … · '
                   'Zonne-overschot is hoger/lager dan … · Laadniveau is hoger/lager dan … · Demo-modus staat aan/uit'],
                  ['Dan (actie)', 'Strategie instellen · Laden met X W · Ontladen met X W · Net-doelwaarde instellen · '
                   'Demo-modus aan/uit zetten'],
              ], [34 * mm, CONTENT_W - 34 * mm]),
              H2('10.2 Voorbeelden'),
              *bullets([
                  '<b>Laadpaal:</b> <i>Als</i> auto begint met laden → <i>Dan</i> strategie <i>Alleen laden met zon</i>. '
                  '<i>Als</i> auto stopt → <i>Dan</i> strategie <i>Dynamisch</i>. Zo leegt de auto de batterij niet.',
                  '<b>Goedkope stroom benutten:</b> <i>Als</i> geplande actie is veranderd <i>En</i> geplande actie is '
                  '<i>Laden</i> → <i>Dan</i> boiler/vaatwasser aan.',
                  '<b>Vakantie:</b> <i>Als</i> afwezigheidsmodus aan → <i>Dan</i> strategie <i>Zelfconsumptie</i>.',
                  '<b>Onweer/stroomuitval verwacht:</b> <i>Dan</i> laden met 800 W; na volladen strategie '
                  '<i>Uit</i> om de reserve te bewaren.',
                  '<b>Melding:</b> <i>Als</i> apparaat niet beschikbaar → <i>Dan</i> pushbericht (bewaking).',
              ]),
              H2('10.3 Mijn Flows'),
              table([['Naam Flow', 'Wat doet hij', 'Getest']] +
                    [[TextField(48 * mm, 16, name=f'flow_{i}_n'), TextField(CONTENT_W - 84 * mm, 16, name=f'flow_{i}_w'),
                      CheckBox(name=f'flow_{i}_ok')] for i in range(6)],
                    [52 * mm, CONTENT_W - 76 * mm, 24 * mm], zebra=False),
              PageBreak()]

    # ---------- 11 periodieke controle
    story += [H1('11. Periodieke controle en onderhoud'),
              P('Controleer de installatie de eerste maand wekelijks en daarna maandelijks. Lees de tellers '
                '<i>Geladen</i> en <i>Ontladen</i> af in Homey (apparaat of Insights). Het werkelijke rendement is '
                'ontladen ÷ geladen over een langere periode (neem een periode waarin het laadniveau aan begin en '
                'eind gelijk is). De app berekent dit ook zelf: <i>Geleerd rendement</i> (over maximaal 14 dagen, '
                'zodra er 5 kWh is geladen). <i>Opbrengst vandaag/totaal</i> is de waarde van de ontladen stroom '
                'min de kosten van de geladen stroom, tegen de all-in prijs van dat kwartier. Met saldering (tot '
                'eind 2026) is dat de echte besparing ten opzichte van geen batterij.'),
              H2('11.1 Maandelijkse checklist'),
              checklist('c11', [
                  ('Apparaat beschikbaar, geen foutmeldingen in Homey', ''),
                  ('Laadniveau Homey en Zendure-app komen overeen', ''),
                  ('Zendure-firmware: update beschikbaar? Na update test T1–T3 herhalen', 'Noteer versie'),
                  ('Zendure-app: slimme modi nog steeds uit (niet teruggezet door update)', ''),
                  ('Prijs in Homey komt overeen met Zonneplan-app', ''),
                  ('Opslag / energiebelasting gewijzigd (bijv. per 1 januari)?', 'Instellingen bijwerken'),
                  ('Batterij en kabels: geen warmte, geur of beschadiging', ''),
                  ('Vaste IP-adressen nog geldig (bijv. na nieuwe router)', ''),
                  ('Geleerd rendement plausibel (80–92 %)', 'Noteer waarde'),
                  ('Na 1 januari 2027 (einde saldering): minimale winst en terugleveren heroverwegen', ''),
              ]),
              H2('11.2 Meetlog'),
              table([['Datum', 'Laadn. %', 'Geladen kWh', 'Ontladen kWh', 'Rendement %', 'Opbrengst €',
                      'Opmerking']] +
                    [[TextField(20 * mm, 16, name=f'log_{i}_d'), TextField(14 * mm, 16, name=f'log_{i}_s'),
                      TextField(18 * mm, 16, name=f'log_{i}_g'), TextField(18 * mm, 16, name=f'log_{i}_o'),
                      TextField(18 * mm, 16, name=f'log_{i}_r'), TextField(18 * mm, 16, name=f'log_{i}_e'),
                      TextField(CONTENT_W - 140 * mm, 16, name=f'log_{i}_m')] for i in range(14)],
                    [24 * mm, 18 * mm, 22 * mm, 22 * mm, 22 * mm, 22 * mm, CONTENT_W - 130 * mm], zebra=False),
              PageBreak()]

    # ---------- 12 problemen
    story += [H1('12. Problemen oplossen'),
              table([
                  ['Probleem', 'Mogelijke oorzaak', 'Oplossing'],
                  ['Koppelen: „Zendure niet bereikbaar”', 'Verkeerd IP, ander netwerk, oude firmware',
                   'IP controleren via router; /properties/report in browser testen; firmware bijwerken'],
                  ['Koppelen: „P1 niet bereikbaar”', 'Lokale API uit', 'HomeWizard Energy-app → P1 → Lokale API aan'],
                  ['Apparaat „niet beschikbaar”', '5× achter elkaar geen verbinding',
                   'Netwerk/IP controleren; herstelt vanzelf zodra de verbinding terug is'],
                  ['Batterij volgt commando\'s niet of springt terug', 'Zendure-app regelt ook (ZENKI/Smart Matching)',
                   'Slimme modi in de Zendure-app uitschakelen (hfdst. 5.2)'],
                  ['Laadt/ontlaadt maximaal 800 W', 'Instelling of hardwarelimiet',
                   'Max vermogen in app en Zendure-app; eigen groep vereist voor meer'],
                  ['Geen stroomprijs / plan „Geen prijzen”', 'Geen internet of API tijdelijk onbereikbaar',
                   'Wacht op de volgende verversing (30 min); de app valt terug op zelfconsumptie'],
                  ['Prijzen van morgen ontbreken', 'Worden rond 13:00 gepubliceerd', 'Normaal; na 13:00 opnieuw kijken'],
                  ['Batterijvermogen in Homey Energy heeft verkeerd teken', 'Tekenconventie',
                   'Melden bij de ontwikkelaar (één regel in device.js)'],
                  ['Pendelen of trage regeling', 'Regelparameters', 'Zie hoofdstuk 9'],
                  ['Webpagina opent niet', 'Ander netwerk/VLAN, poort bezet of webpagina uit',
                   'Zelfde netwerk als Homey; instellingen → Webpagina; bij waarschuwing „poort” een andere poort kiezen'],
                  ['Webpagina: „Onjuiste pincode” / geblokkeerd', 'Verkeerde pincode',
                   'Pincode in Homey controleren; na 10 minuten opnieuw proberen'],
                  ['Waarschuwing „HomeWizard P1 niet bereikbaar”', 'P1 offline, IP gewijzigd of token ongeldig',
                   'P1 in HomeWizard-app controleren; bij API v2 opnieuw Repareren. Batterij staat intussen op '
                   'stand-by'],
                  ['„Zoek in mijn netwerk” vindt niets', 'Ander subnet/VLAN of client-isolatie',
                   'IP-adressen handmatig invullen; Homey en apparaten in hetzelfde netwerk plaatsen'],
                  ['Zonverwachting blijft 0', 'Piekvermogen 0 of locatie Homey onbekend',
                   'Panelgegevens en Homey-locatie controleren; forecast.solar max. 12 verzoeken per uur'],
                  ['Lydos: waarschuwing „te veel verzoeken”', 'Ariston-cloud begrenst (HTTP 429)',
                   'Lydos-app pauzeert zelf; Flows minder vaak laten schakelen'],
              ], [46 * mm, 52 * mm, CONTENT_W - 98 * mm]),
              H2('12.1 Storingslog'),
              table([['Datum', 'Omschrijving storing', 'Oplossing / actie']] +
                    [[TextField(22 * mm, 16, name=f'st_{i}_d'), TextField(72 * mm, 16, name=f'st_{i}_o'),
                      TextField(CONTENT_W - 110 * mm, 16, name=f'st_{i}_a')] for i in range(8)],
                    [26 * mm, 76 * mm, CONTENT_W - 102 * mm], zebra=False),
              PageBreak()]

    story += chapter_13()

    # ---------- bijlagen
    story += [H1('Bijlage A. Technische referentie'),
              H2('A.1 Zendure lokale API (zenSDK)'),
              table([
                  ['Eigenschap', 'Betekenis', 'Gebruik door app'],
                  ['electricLevel', 'Gemiddeld laadniveau (%)', 'Laadniveau'],
                  ['outputHomePower', 'Vermogen naar huis (W)', 'Ontladen (AC)'],
                  ['gridInputPower', 'Vermogen uit het net (W)', 'Laden (AC)'],
                  ['acMode', '1 = laden (input), 2 = ontladen (output)', 'Geschreven'],
                  ['inputLimit / outputLimit', 'Laad- / ontlaadvermogen (W)', 'Geschreven'],
                  ['smartMode', '1 = niet naar flash schrijven', 'Altijd 1'],
                  ['minSoc / socSet', 'Ontlaad- / laadgrens (%)', 'Alleen via Zendure-app (vangnet)'],
              ], [40 * mm, 68 * mm, CONTENT_W - 108 * mm]),
              Spacer(1, 4),
              P('Voorbeeld van een schrijfcommando (ontladen met 500 W):', 'small'),
              P('<font name="Courier" size="8">POST http://&lt;ip&gt;/properties/write<br/>'
                '{"sn": "&lt;serienummer&gt;", "properties": {"smartMode": 1, "acMode": 2, '
                '"outputLimit": 500, "inputLimit": 0}}</font>', 'cell'),
              H2('A.2 Bronnen'),
              *bullets([
                  'Home Battery Control: homebatterycontrol.com',
                  'Zendure zenSDK (lokale API): github.com/Zendure/zenSDK',
                  'Zendure Home Assistant-integratie (referentie voor commando\'s): github.com/Zendure/Zendure-HA',
                  'Zendure SolarFlow 2400 AC+ productpagina en ondersteuning: zendure.com',
                  'HomeWizard lokale API: api-documentation.homewizard.com',
                  'Kwartierprijzen: public.api.energyzero.nl; reserve: web-api.tp.entsoe.eu',
                  'Zonverwachting: forecast.solar',
              ]),
              H2('A.3 Bestanden in het project'),
              table([
                  ['Bestand', 'Inhoud'],
                  ['lib/controller.js', 'Strategieën en regelalgoritme (set-point)'],
                  ['lib/planner.js', 'Dynamisch prijsplan'],
                  ['lib/prices.js', 'Ophalen kwartierprijzen'],
                  ['lib/zendure.js / lib/homewizard.js', 'Lokale API-koppelingen (HomeWizard v1 en v2)'],
                  ['lib/forecast.js / lib/entsoe.js', 'Zonverwachting en reserveprijsbron'],
                  ['lib/surplus.js / lib/stats.js', 'Zonne-overschot, opbrengst en geleerd rendement'],
                  ['lib/scanner.js', 'Netwerkscan bij het koppelen'],
                  ['drivers/zendure/', 'Homey-apparaat, koppel- en reparatiescherm, instellingen'],
                  ['widgets/plan/', 'Dashboardwidget Batterijplan'],
                  ['test/*.test.js', 'Tests (npm test)'],
              ], [60 * mm, CONTENT_W - 60 * mm]),
              PageBreak(),
              H1('Bijlage B. Oplevering'),
              P('Met ondertekening wordt bevestigd dat de installatie volgens deze handleiding is uitgevoerd en '
                'dat de tests in hoofdstuk 8 zijn doorlopen.'),
              checklist('opl', [
                  'Alle checklists in hoofdstuk 3 t/m 6 afgevinkt',
                  'Tests T1 t/m T16 goedgekeurd',
                  'Flows uit hoofdstuk 13 ingericht en getest',
                  'Instellingen genoteerd in hoofdstuk 7',
                  'Gebruiker uitgelegd hoe strategieën en Flows werken',
                  'Vangnet-laadgrenzen ingesteld in de Zendure-app',
              ]),
              Spacer(1, 10),
              fields('opl_s', ['Naam installateur / uitvoerder', 'Handtekening', 'Naam gebruiker',
                               'Handtekening', 'Datum oplevering']),
              Spacer(1, 10),
              remarks('opl', 110, 'Opmerkingen bij oplevering'),
              ]

    doc = Doc(OUT)
    doc.multiBuild(story)
    print('geschreven:', OUT)


if __name__ == '__main__':
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    build()
