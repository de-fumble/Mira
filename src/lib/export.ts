import "server-only";
import path from "node:path";
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  LevelFormat,
  Packer,
  PageNumber,
  Paragraph,
  TextRun,
} from "docx";
import PDFDocument from "pdfkit";
import { parseDoc, type Run } from "./rich-text";
import { formatClock, formatDuration, speakerLabel, type MeetingSummary, type Segment } from "./transcript";

/** Everything an exported file contains. */
export type ExportMeeting = {
  title: string;
  dateLine: string; // e.g. "Sunday, 15 November 2026 at 7:47"
  durationSeconds: number | null;
  transcript: Segment[];
  summary: MeetingSummary | null;
};

// Same speaker colours as the app (text on white).
const SPEAKER_HEX = ["1D1D1F", "2F5FD0", "A8431B", "2E6B52", "7A3E9D", "8A6D00"];
const speakerHex = (s: number) => SPEAKER_HEX[s % SPEAKER_HEX.length];
const INK = "1D1D1F";
const MUTED = "6E6E73";

function metaLine(m: ExportMeeting) {
  const speakers = new Set(m.transcript.map((s) => s.speaker)).size;
  return [m.dateLine, formatDuration(m.durationSeconds), speakers ? `${speakers} ${speakers === 1 ? "speaker" : "speakers"}` : null]
    .filter(Boolean)
    .join("  ·  ");
}

function notesSections(s: MeetingSummary | null): { heading: string; items: string[]; prose?: boolean }[] {
  if (!s) return [];
  return [
    { heading: "Summary", items: [s.summary], prose: true },
    { heading: "Key points", items: s.key_points ?? [] },
    { heading: "Decisions", items: s.decisions ?? [] },
    {
      heading: "Action items",
      items: (s.action_items ?? []).map((a) => [a.task, [a.owner, a.due].filter(Boolean).join(", ")].filter(Boolean).join(" — ")),
    },
  ].filter((x) => x.items.length && x.items.some((i) => i?.trim()));
}

/** "Spring budget review – 15 Nov 2026.pdf", safe for every OS. */
export function exportFilename(title: string, shortDate: string, ext: string) {
  const clean = `${title} – ${shortDate}`.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  return `${clean || "Meeting"}.${ext}`;
}

// ---------------------------------------------------------------- Word

export async function buildDocx(m: ExportMeeting): Promise<Buffer> {
  const children: Paragraph[] = [
    new Paragraph({ heading: HeadingLevel.TITLE, spacing: { after: 80 }, children: [new TextRun({ text: m.title, bold: true, size: 44, color: INK })] }),
    new Paragraph({
      spacing: { after: 360 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "E5E5EA", space: 12 } },
      children: [new TextRun({ text: metaLine(m), size: 20, color: MUTED })],
    }),
  ];

  const h = (text: string) =>
    new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 320, after: 140 }, children: [new TextRun({ text, bold: true, size: 30, color: INK })] });

  for (const sec of notesSections(m.summary)) {
    children.push(h(sec.heading));
    for (const item of sec.items) {
      children.push(
        sec.prose
          ? new Paragraph({ spacing: { after: 120, line: 320 }, children: [new TextRun({ text: item, size: 23 })] })
          : new Paragraph({ bullet: { level: 0 }, spacing: { after: 80, line: 300 }, children: [new TextRun({ text: item, size: 22 })] }),
      );
    }
  }

  children.push(h("Transcript"));
  if (!m.transcript.length) {
    children.push(new Paragraph({ children: [new TextRun({ text: "No words were captured in this recording.", color: MUTED, size: 22 })] }));
  }
  for (const seg of m.transcript) {
    children.push(
      new Paragraph({
        keepNext: true,
        spacing: { before: 200, after: 40 },
        children: [
          new TextRun({ text: speakerLabel(seg.speaker), bold: true, size: 20, color: speakerHex(seg.speaker) }),
          new TextRun({ text: `   ${formatClock(seg.start)}`, size: 18, color: MUTED }),
        ],
      }),
      new Paragraph({ spacing: { after: 80, line: 320 }, children: [new TextRun({ text: seg.text, size: 22, color: INK })] }),
    );
  }

  const doc = new Document({
    creator: "Mira",
    title: m.title,
    description: "Meeting transcript exported from Mira",
    styles: { default: { document: { run: { font: "Calibri", size: 22, color: INK } } } },
    sections: [
      {
        properties: { page: { margin: { top: 1200, bottom: 1200, left: 1200, right: 1200 } } },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ text: "Transcribed with Mira  ·  Page ", size: 16, color: MUTED }),
                  new TextRun({ children: [PageNumber.CURRENT], size: 16, color: MUTED }),
                  new TextRun({ text: " of ", size: 16, color: MUTED }),
                  new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: MUTED }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });
  return Packer.toBuffer(doc);
}

// ---------------------------------------------------------------- PDF

// Noto Sans covers accented Latin (e.g. Yoruba ẹ ọ ṣ), unlike the PDF built-in fonts.
const FONT_DIR = path.join(process.cwd(), "assets", "fonts");
const REGULAR = path.join(FONT_DIR, "NotoSans-Regular.ttf");
const BOLD = path.join(FONT_DIR, "NotoSans-SemiBold.ttf");

export function buildPdf(m: ExportMeeting): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const margin = 64;
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: margin, bottom: margin + 16, left: margin, right: margin },
      bufferPages: true, // so page numbers can be added at the end
      font: REGULAR,
      info: { Title: m.title, Author: "Mira", Creator: "Mira" },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.registerFont("body", REGULAR);
    doc.registerFont("bold", BOLD);
    const width = doc.page.width - margin * 2;
    const hex = (h: string) => `#${h}`;

    // Title + details
    doc.font("bold").fontSize(22).fillColor(hex(INK)).text(m.title, { width, lineGap: 2 });
    doc.moveDown(0.3);
    doc.font("body").fontSize(10).fillColor(hex(MUTED)).text(metaLine(m), { width });
    doc.moveDown(0.8);
    doc.moveTo(margin, doc.y).lineTo(margin + width, doc.y).lineWidth(0.5).strokeColor("#E5E5EA").stroke();
    doc.moveDown(1);

    const heading = (text: string) => {
      if (doc.y > doc.page.height - 160) doc.addPage();
      doc.font("bold").fontSize(15).fillColor(hex(INK)).text(text, margin, doc.y, { width });
      doc.moveDown(0.5);
    };

    for (const sec of notesSections(m.summary)) {
      heading(sec.heading);
      if (sec.prose) {
        doc.font("body").fontSize(11.5).fillColor(hex(INK)).text(sec.items[0], { width, lineGap: 3.5 });
      } else {
        for (const item of sec.items) {
          const y = doc.y;
          doc.font("body").fontSize(11).fillColor(hex(MUTED)).text("•", margin + 2, y, { width: 12 });
          doc.fillColor(hex(INK)).text(item, margin + 16, y, { width: width - 16, lineGap: 3 });
          doc.moveDown(0.25);
        }
      }
      doc.x = margin;
      doc.moveDown(0.9);
    }

    heading("Transcript");
    if (!m.transcript.length) {
      doc.font("body").fontSize(11).fillColor(hex(MUTED)).text("No words were captured in this recording.", { width });
    }
    for (const seg of m.transcript) {
      // Keep the speaker line with at least the start of what they said.
      if (doc.y > doc.page.height - margin - 70) doc.addPage();
      doc.font("bold").fontSize(9.5).fillColor(hex(speakerHex(seg.speaker))).text(speakerLabel(seg.speaker), margin, doc.y, { continued: true });
      doc.font("body").fillColor(hex(MUTED)).text(`   ${formatClock(seg.start)}`);
      doc.moveDown(0.15);
      doc.font("body").fontSize(11).fillColor(hex(INK)).text(seg.text, margin, doc.y, { width, lineGap: 3 });
      doc.moveDown(0.7);
    }

    // Footer on every page
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const bottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0; // writing in the margin must not add a page
      doc
        .font("body")
        .fontSize(8.5)
        .fillColor(hex(MUTED))
        .text(`Transcribed with Mira  ·  Page ${i + 1} of ${range.count}`, margin, doc.page.height - margin + 8, { width, align: "center" });
      doc.page.margins.bottom = bottom;
    }
    doc.end();
  });
}

// ---------------------------------------------------------------- Documents

type ExportDocument = { title: string; content: string };

/** Word runs for one paragraph: bold / italic / underline, line breaks inside. */
function docxRuns(runs: Run[], size: number, bold = false): TextRun[] {
  const out: TextRun[] = [];
  let lineBreak = false;
  for (const r of runs) {
    r.text.split("\n").forEach((text, i) => {
      if (i) lineBreak = true;
      if (!text) return;
      out.push(
        new TextRun({
          text,
          size,
          bold: bold || r.marks.includes("b") || undefined,
          italics: r.marks.includes("i") || undefined,
          underline: r.marks.includes("u") ? {} : undefined,
          break: lineBreak ? 1 : undefined,
        }),
      );
      lineBreak = false;
    });
  }
  if (lineBreak) out.push(new TextRun({ text: "", size, break: 1 }));
  return out;
}

/** A document as a clean Word file: title, its headings, lists and bold text, page numbers. */
export async function buildDocumentDocx(d: ExportDocument): Promise<Buffer> {
  const blocks = parseDoc(d.content);
  const body: Paragraph[] = [];
  let numbered = 0; // each numbered list starts again at 1
  blocks.forEach((b, i) => {
    const prev = blocks[i - 1]?.type;
    const next = blocks[i + 1]?.type;
    if (b.type === "h1" || b.type === "h2") {
      const h1 = b.type === "h1";
      body.push(
        new Paragraph({
          heading: h1 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2,
          keepNext: true,
          spacing: { before: i ? (h1 ? 360 : 280) : 0, after: 120 },
          children: docxRuns(b.runs, h1 ? 32 : 27, true),
        }),
      );
    } else if (b.type === "ul" || b.type === "ol") {
      if (b.type === "ol" && prev !== "ol") numbered++;
      body.push(
        new Paragraph({
          ...(b.type === "ul" ? { bullet: { level: 0 } } : { numbering: { reference: "mira-numbers", level: 0, instance: numbered } }),
          spacing: { after: next === b.type ? 80 : 200, line: 312 },
          children: docxRuns(b.runs, 24),
        }),
      );
    } else {
      body.push(new Paragraph({ spacing: { after: 200, line: 312 }, children: docxRuns(b.runs, 24) }));
    }
  });
  const doc = new Document({
    creator: "Mira",
    title: d.title,
    styles: {
      default: { document: { run: { font: "Calibri", size: 24, color: INK } } },
      paragraphStyles: [
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", run: { font: "Calibri", color: INK, bold: true } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", run: { font: "Calibri", color: INK, bold: true } },
      ],
    },
    numbering: {
      config: [
        {
          reference: "mira-numbers",
          levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.START, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }],
        },
      ],
    },
    sections: [
      {
        properties: { page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ text: "Page ", size: 18, color: MUTED }),
                  new TextRun({ children: [PageNumber.CURRENT], size: 18, color: MUTED }),
                  new TextRun({ text: " of ", size: 18, color: MUTED }),
                  new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 18, color: MUTED }),
                ],
              }),
            ],
          }),
        },
        children: [
          new Paragraph({ heading: HeadingLevel.TITLE, spacing: { after: 320 }, children: [new TextRun({ text: d.title, bold: true, size: 40, color: INK })] }),
          ...(body.length ? body : [new Paragraph({ children: [new TextRun({ text: "" })] })]),
        ],
      },
    ],
  });
  return Packer.toBuffer(doc);
}

/** The same document as an A4 PDF. */
export function buildDocumentPdf(d: ExportDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const margin = 72;
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: margin, bottom: margin + 12, left: margin, right: margin },
      bufferPages: true,
      font: REGULAR,
      info: { Title: d.title, Author: "Mira", Creator: "Mira" },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.registerFont("body", REGULAR);
    doc.registerFont("bold", BOLD);
    const width = doc.page.width - margin * 2;
    const ink = `#${INK}`;

    doc.font("bold").fontSize(20).fillColor(ink).text(d.title, { width, lineGap: 2 });
    doc.moveDown(1);

    /** One block's runs at (x, y), each in its own style, flowing as one paragraph. */
    const write = (runs: Run[], x: number, w: number, size: number, bold = false) => {
      const parts = runs.filter((r) => r.text);
      if (!parts.length) {
        doc.font("body").fontSize(size).text(" ", x, doc.y, { width: w });
        return;
      }
      parts.forEach((r, i) => {
        const last = i === parts.length - 1;
        doc
          .font(bold || r.marks.includes("b") ? "bold" : "body")
          .fontSize(size)
          .fillColor(ink);
        const opts = { continued: !last, underline: r.marks.includes("u"), oblique: r.marks.includes("i") ? 12 : false, lineGap: 4 };
        if (i === 0) doc.text(r.text, x, doc.y, { ...opts, width: w });
        else doc.text(r.text, opts);
      });
    };

    const blocks = parseDoc(d.content);
    let n = 0;
    blocks.forEach((b, i) => {
      const next = blocks[i + 1]?.type;
      if (b.type === "h1" || b.type === "h2") {
        const h1 = b.type === "h1";
        if (doc.y > doc.page.height - margin - 90) doc.addPage(); // keep a heading with what follows
        if (i) doc.moveDown(h1 ? 0.5 : 0.3);
        write(b.runs, margin, width, h1 ? 16 : 13.5, true);
        doc.moveDown(0.45);
      } else if (b.type === "ul" || b.type === "ol") {
        n = b.type === "ol" && blocks[i - 1]?.type === "ol" ? n + 1 : 1;
        const y = doc.y;
        doc.font("body").fontSize(12).fillColor(`#${MUTED}`).text(b.type === "ul" ? "•" : `${n}.`, margin + 2, y, { width: 20 });
        doc.y = y;
        write(b.runs, margin + 22, width - 22, 12);
        doc.moveDown(next === b.type ? 0.3 : 0.8);
      } else {
        write(b.runs, margin, width, 12);
        doc.moveDown(0.8);
      }
    });

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const bottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc
        .font("body")
        .fontSize(9)
        .fillColor(`#${MUTED}`)
        .text(`Page ${i + 1} of ${range.count}`, margin, doc.page.height - margin + 16, { width, align: "center" });
      doc.page.margins.bottom = bottom;
    }
    doc.end();
  });
}
