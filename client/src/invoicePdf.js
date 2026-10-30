import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

const NAVY = [23, 58, 103];
const PALE = [238, 245, 253];
const INK = [25, 48, 83];
const MUTED = [91, 111, 139];
const formatINR = (amount) => `INR ${Number(amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const formatDate = (value) => value ? new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

function drawBrand(doc, x, y, scale = 1, color = NAVY) {
  doc.setDrawColor(...color);
  doc.setLineWidth(1.1 * scale);
  doc.circle(x + 7 * scale, y + 7 * scale, 6 * scale);
  doc.line(x + 7 * scale, y + 1 * scale, x + 7 * scale, y + 13 * scale);
  doc.line(x + 1 * scale, y + 7 * scale, x + 13 * scale, y + 7 * scale);
  doc.line(x + 2.8 * scale, y + 2.8 * scale, x + 11.2 * scale, y + 11.2 * scale);
  doc.line(x + 2.8 * scale, y + 11.2 * scale, x + 11.2 * scale, y + 2.8 * scale);
  doc.setFillColor(255, 255, 255);
  doc.circle(x + 7 * scale, y + 7 * scale, 1.8 * scale, 'F');
}

function drawWatermark(doc) {
  const { width, height } = doc.internal.pageSize;
  const centerX = width / 2;
  const centerY = height / 2;
  doc.setGState(new doc.GState({ opacity: 0.075 }));
  doc.setTextColor(248, 249, 251);
  doc.setDrawColor(249, 250, 252);
  doc.setLineWidth(1.1);
  doc.circle(centerX, centerY - 5, 20);
  doc.line(centerX, centerY - 25, centerX, centerY + 15);
  doc.line(centerX - 20, centerY - 5, centerX + 20, centerY - 5);
  doc.line(centerX - 14, centerY - 19, centerX + 14, centerY + 9);
  doc.line(centerX - 14, centerY + 9, centerX + 14, centerY - 19);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(26);
  doc.text('haven.', centerX, centerY + 29, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text('HOTEL MANAGEMENT', centerX, centerY + 36, { align: 'center', charSpace: 2 });
  doc.setGState(new doc.GState({ opacity: 1 }));
}

export function downloadInvoicePdf(invoice) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;
  const right = pageWidth - margin;
  const snap = invoice.snapshot || {};
  const guestName = invoice.guest?.name || snap.guest || 'Guest';
  const roomName = invoice.room?.type || snap.roomType || 'Room';
  const roomNumber = invoice.room?.number || snap.room || '—';
  const checkIn = invoice.checkIn || snap.checkIn;
  const checkOut = invoice.checkOut || snap.checkOut;
  const nights = Math.max(1, Math.round((new Date(`${checkOut}T00:00:00`) - new Date(`${checkIn}T00:00:00`)) / 86400000));
  const hotel = invoice.hotel || {};
  const hotelName = hotel.name || 'Haven Hotel';
  const roomSubtotal = Number(invoice.nightlyRate ?? snap.nightlyRate ?? 0) * nights;
  const extraCharges = Number(invoice.additionalCharges ?? snap.additionalCharges ?? 0);

  drawBrand(doc, margin, 12, 1.25);
  doc.setTextColor(...NAVY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(hotelName, margin + 21, 20);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...MUTED);
  doc.text('STAY  •  RELAX  •  ENJOY', margin + 22, 26, { charSpace: 1.1 });

  doc.setFontSize(8);
  doc.setTextColor(...INK);
  const hotelLines = [hotel.address, hotel.phone, hotel.email].filter(Boolean);
  hotelLines.slice(0, 3).forEach((line, index) => doc.text(String(line), right, 15 + index * 5, { align: 'right', maxWidth: 75 }));
  doc.setDrawColor(77, 132, 190);
  doc.setLineWidth(0.45);
  doc.line(margin, 34, right, 34);

  doc.setTextColor(...NAVY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(25);
  doc.text('INVOICE', margin + 1, 47);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text('Thank you for choosing us. We look forward to serving you again.', margin + 1, 54, { maxWidth: 95 });

  const infoX = 118;
  const infoY = 39;
  doc.setFillColor(...PALE);
  doc.roundedRect(infoX, infoY, right - infoX, 29, 2, 2, 'F');
  const info = [
    ['Invoice No', invoice.confirmationNumber || `HVN-${String(invoice.reservationId).padStart(6, '0')}`],
    ['Date', formatDate(invoice.createdAt)],
    ['Payment Status', invoice.paymentStatus || 'Pending'],
    ['Reservation No', `RSN-${String(invoice.reservationId).padStart(6, '0')}`],
  ];
  doc.setFontSize(8);
  info.forEach(([label, value], index) => {
    const y = infoY + 7 + index * 5.2;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...INK);
    doc.text(label, infoX + 6, y);
    doc.text(':', infoX + 35, y);
    doc.setFont('helvetica', 'bold');
    doc.text(String(value), infoX + 39, y, { maxWidth: right - infoX - 44 });
  });

  const sectionY = 78;
  doc.setDrawColor(194, 214, 235);
  doc.line(pageWidth / 2, sectionY, pageWidth / 2, sectionY + 41);
  doc.setTextColor(...NAVY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('GUEST DETAILS', margin + 1, sectionY + 5);
  doc.text('RESERVATION DETAILS', pageWidth / 2 + 7, sectionY + 5);
  const guestLines = [['Name', guestName], ['Email', invoice.guest?.email || '—'], ['Phone', invoice.guest?.phone || '—']];
  const reservationLines = [['Room Type', roomName], ['Room No', String(roomNumber)], ['Check In', formatDate(checkIn)], ['Check Out', formatDate(checkOut)], ['No. of Nights', String(nights)]];
  doc.setFontSize(8);
  guestLines.forEach(([label, value], index) => {
    const y = sectionY + 13 + index * 7;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...INK);
    doc.text(label, margin + 1, y);
    doc.text(':', margin + 28, y);
    doc.text(String(value), margin + 32, y, { maxWidth: 48 });
  });
  reservationLines.forEach(([label, value], index) => {
    const y = sectionY + 13 + index * 6.3;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...INK);
    doc.text(label, pageWidth / 2 + 7, y);
    doc.text(':', pageWidth / 2 + 33, y);
    doc.text(String(value), pageWidth / 2 + 37, y, { maxWidth: 55 });
  });

  const rows = [[`${roomName} · Room ${roomNumber}`, `${nights} night${nights === 1 ? '' : 's'}`, formatINR(invoice.nightlyRate ?? snap.nightlyRate), formatINR(roomSubtotal)]];
  if (extraCharges > 0) rows.push(['Additional charges', '1 service', formatINR(extraCharges), formatINR(extraCharges)]);
  autoTable(doc, {
    startY: 125,
    head: [['S.No', 'Description', 'Quantity', 'Rate', 'Amount']],
    body: rows.map((row, index) => [String(index + 1), ...row]),
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 8, textColor: INK, lineColor: [215, 227, 240], cellPadding: 2.6 },
    headStyles: { fillColor: NAVY, textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [246, 250, 255] },
    columnStyles: { 0: { cellWidth: 13, halign: 'center' }, 1: { cellWidth: 67 }, 2: { cellWidth: 27, halign: 'center' }, 3: { cellWidth: 35, halign: 'right' }, 4: { halign: 'right' } },
    margin: { left: margin, right: margin },
  });

  let y = doc.lastAutoTable.finalY + 8;
  const subtotal = Number(invoice.subtotal ?? snap.subtotal ?? roomSubtotal + extraCharges);
  const discount = Number(invoice.discount ?? snap.discount ?? 0);
  const taxes = Number(invoice.taxes ?? snap.taxes ?? 0);
  const total = Number(invoice.total ?? snap.total ?? subtotal - discount + taxes);
  const paid = Number(invoice.payments?.reduce((sum, payment) => sum + (payment.status === 'Completed' ? Number(payment.amount) : 0), 0) || 0);
  const summaryX = 119;
  const summaryW = right - summaryX;
  doc.setFillColor(...PALE);
  doc.roundedRect(summaryX, y, summaryW, 31, 2, 2, 'F');
  [['Sub Total', formatINR(subtotal)], ['Discount', formatINR(discount)], [`Tax (GST ${Number(hotel.taxRate || 0)}%)`, formatINR(taxes)]].forEach(([label, value], index) => {
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...INK);
    doc.setFontSize(8);
    doc.text(label, summaryX + 5, y + 7 + index * 7);
    doc.text(value, right - 5, y + 7 + index * 7, { align: 'right' });
  });
  doc.setFillColor(...NAVY);
  doc.roundedRect(summaryX, y + 32, summaryW, 12, 1.5, 1.5, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(255, 255, 255);
  doc.text('TOTAL AMOUNT', summaryX + 5, y + 40);
  doc.text(formatINR(total), right - 5, y + 40, { align: 'right' });

  y += 52;
  doc.setTextColor(...NAVY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('PAYMENT SUMMARY', margin, y);
  const paymentRows = (invoice.payments || []).map((payment) => [formatDate(payment.paidAt), payment.method || '—', payment.reference || '—', payment.status, formatINR(payment.amount)]);
  if (!paymentRows.length) paymentRows.push(['—', 'No payment recorded', '—', 'Pending', formatINR(0)]);
  autoTable(doc, {
    startY: y + 3,
    head: [['Date', 'Mode of Payment', 'Transaction ID', 'Status', 'Amount']],
    body: paymentRows,
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 7.5, textColor: INK, lineColor: [215, 227, 240], cellPadding: 2.2 },
    headStyles: { fillColor: [229, 239, 251], textColor: NAVY, fontStyle: 'bold' },
    margin: { left: margin, right: margin },
  });

  const footerY = Math.min(doc.lastAutoTable.finalY + 18, 280);
  doc.setFillColor(232, 247, 239);
  doc.roundedRect(margin, footerY - 8, right - margin, 10, 2, 2, 'F');
  doc.setTextColor(26, 121, 78);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text(paid >= total && total > 0 ? 'Payment received — thank you for your payment!' : `Amount paid: ${formatINR(paid)}   ·   Balance due: ${formatINR(Math.max(0, total - paid))}`, margin + 5, footerY - 2);
  doc.setDrawColor(135, 170, 207);
  doc.line(margin, footerY + 8, right, footerY + 8);
  doc.setTextColor(...NAVY);
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(17);
  doc.text('Thank You!', margin + 1, footerY + 19);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text('We hope you had a wonderful stay with us. Come back soon!', margin + 1, footerY + 25);
  doc.setFont('helvetica', 'bold');
  doc.text(hotelName, right, footerY + 20, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.text('Your comfort, our priority', right, footerY + 25, { align: 'right' });

  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    drawWatermark(doc);
    doc.setTextColor(...MUTED);
    doc.setFontSize(7);
    doc.text(`${page} / ${pageCount}`, right, 289, { align: 'right' });
  }
  const filename = `${invoice.confirmationNumber || `haven-invoice-${invoice.reservationId}`}.pdf`;
  doc.save(filename);
}
