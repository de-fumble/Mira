import "server-only";
import path from "node:path";
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  Packer,
  PageNumber,
  Paragraph,
  TextRun,
} from "docx";
import PDFDocument from "pdfkit";
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
