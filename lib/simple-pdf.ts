function pdfText(value: string) {
  return value.normalize('NFKD').replace(/[^\x20-\x7E]/g, '').replace(/([\\()])/g, '\\$1')
}

export function onePagePdf(title: string, lines: string[]) {
  const contentLines = [
    'BT',
    '/F1 16 Tf',
    '50 760 Td',
    `(${pdfText(title)}) Tj`,
    '/F1 9 Tf',
    '0 -26 Td',
    ...lines.flatMap((line) => {
      const chunks = line.match(/.{1,95}(?:\s|$)|.{1,95}/g) || ['']
      return chunks.map((chunk) => `(${pdfText(chunk.trim())}) Tj\n0 -13 Td`)
    }),
    'ET',
  ].join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(contentLines, 'ascii')} >>\nstream\n${contentLines}\nendstream`,
  ]
  let document = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(document, 'ascii'))
    document += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = Buffer.byteLength(document, 'ascii')
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets.slice(1)) document += `${String(offset).padStart(10, '0')} 00000 n \n`
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return Buffer.from(document, 'ascii')
}
