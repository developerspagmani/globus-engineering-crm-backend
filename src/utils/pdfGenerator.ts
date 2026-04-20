import PDFDocument from 'pdfkit';
import { numberToWords } from './numberToWords';

export interface InvoicePDFData {
  invoiceNumber: string;
  invoiceDate: string;
  dcNo: string;
  dcDate: string;
  poNo: string;
  poDate: string;
  customerName: string;
  customerAddress: string;
  customerGst: string;
  items: Array<{
    description: string;
    hsn?: string;
    quantity: number;
    price: number;
    amount: number;
  }>;
  subTotal: number;
  taxTotal: number;
  grandTotal: number;
  companyName: string;
  companyAddress: string;
  companyGst: string;
  bankDetails: {
    bankName: string;
    accNo: string;
    ifsc: string;
  };
}

export const generateInvoicePDF = (data: InvoicePDFData): Promise<Buffer> => {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0 });
    const chunks: any[] = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // --- Layout Constants ---
    const leftX = 40;
    const rightX = 555;
    const width = rightX - leftX;

    // Helper for table rows
    const drawRowLine = (y: number) => {
      doc.moveTo(leftX, y).lineTo(rightX, y).stroke();
    };

    // --- Outer Border ---
    doc.rect(leftX, 40, width, 750).stroke();

    // --- Top Header Section ---
    // Left Octagon Logo
    doc.save();
    doc.translate(55, 55);
    const scale = 0.5;
    doc.scale(scale);
    doc.path('M25 5 L75 5 L95 25 L95 75 L75 95 L25 95 L5 75 L5 25 Z').stroke();
    doc.circle(50, 50, 28).stroke();
    doc.path('M50 20 L50 10 M50 80 L50 90 M20 50 L10 50 M80 50 L90 50').stroke();
    doc.fontSize(32).text('S', 34, 40, { width: 32, align: 'center' });
    doc.restore();

    // Center Text
    doc.fontSize(22).font('Helvetica-Bold').text('GLOBUS ENGINEERING MAIN', 130, 60, { width: 330, align: 'center' });
    doc.fontSize(10).font('Helvetica-Bold').text('An ISO 9001: 2015 Certified Company', 130, 85, { width: 330, align: 'center' });
    doc.fontSize(8).font('Helvetica').text('Precision Machining & Quality Engineering Solutions', 130, 97, { width: 330, align: 'center' });

    // Right TÜV SÜD Logo
    doc.rect(480, 50, 60, 60).stroke();
    doc.fontSize(8).font('Helvetica-Bold').text('Q', 480, 52, { width: 60, align: 'center' });
    doc.moveTo(480, 62).lineTo(540, 62).stroke();
    doc.fontSize(16).text('TÜV', 480, 70, { width: 60, align: 'center' });
    doc.fontSize(10).text('SÜD', 480, 85, { width: 60, align: 'center' });
    doc.moveTo(480, 100).lineTo(540, 100).stroke();
    doc.fontSize(7).text('ISO 9001', 480, 103, { width: 60, align: 'center' });

    doc.moveTo(leftX, 120).lineTo(rightX, 120).stroke();

    // --- Meta Grid ---
    let y = 120;
    doc.fontSize(8).font('Helvetica');
    const drawCol = (x: number, label: string, val: string, w: number) => {
      doc.font('Helvetica').text(label, x + 5, y + 4);
      doc.font('Helvetica-Bold').text(`: ${val}`, x + 65, y + 4);
      if (x > leftX) doc.moveTo(x, y).lineTo(x, y + 15).stroke();
    };

    drawCol(leftX, 'Invoice No', data.invoiceNumber, 130);
    drawCol(leftX + 130, 'DC No', data.dcNo, 130);
    drawCol(leftX + 260, 'PO No', data.poNo, 130);
    drawCol(leftX + 390, 'State', 'TamilNadu-33', 130);

    y += 15;
    drawRowLine(y);
    drawCol(leftX, 'Invoice Date', data.invoiceDate, 130);
    drawCol(leftX + 130, 'DC Dte', data.dcDate, 130);
    drawCol(leftX + 260, 'PO Date', data.poDate, 130);
    drawCol(leftX + 390, 'Reverse Charge (Y/N)', 'N', 130);

    y += 15;
    drawRowLine(y);

    // --- TAX INVOICE BAR ---
    doc.rect(leftX, y, width, 18).fillColor('#f0f0f0').fill();
    doc.fillColor('black').font('Helvetica-Bold').fontSize(11).text('TAX INVOICE', leftX, y + 4, { align: 'center' });
    y += 18;
    drawRowLine(y);

    // --- Address Headers ---
    doc.rect(leftX, y, width / 2, 15).fillColor('#f0f0f0').fill();
    doc.rect(leftX + width / 2, y, width / 2, 15).fillColor('#f0f0f0').fill();
    doc.fillColor('black').fontSize(8).text('SUPPLIER DETAILS :', leftX + 5, y + 4);
    doc.text('RECEIPIENTS DETAILS :', leftX + width / 2 + 5, y + 4);
    doc.moveTo(leftX + width / 2, y).lineTo(leftX + width / 2, y + 80).stroke();
    y += 15;
    drawRowLine(y);

    // --- Address Content ---
    const addrY = y + 5;
    doc.fontSize(8);
    // Supplier
    doc.font('Helvetica').text('Name', leftX + 5, addrY);
    doc.font('Helvetica-Bold').text(`: ${data.companyName}`, leftX + 45, addrY);
    doc.font('Helvetica').text('Address', leftX + 5, addrY + 12);
    doc.text(`: ${data.companyAddress}`, leftX + 45, addrY + 12, { width: 200 });
    doc.text('GST No', leftX + 5, addrY + 36);
    doc.font('Helvetica-Bold').text(`: ${data.companyGst}`, leftX + 45, addrY + 36);
    doc.font('Helvetica').text('State', leftX + 5, addrY + 48);
    doc.text(': Tamilnadu', leftX + 45, addrY + 48);
    doc.text('Code : 33', leftX + 180, addrY + 48);

    // Recipient
    doc.font('Helvetica').text('Name', leftX + width / 2 + 5, addrY);
    doc.font('Helvetica-Bold').text(`: ${data.customerName}`, leftX + width / 2 + 45, addrY);
    doc.font('Helvetica').text('Address', leftX + width / 2 + 5, addrY + 12);
    doc.text(`: ${data.customerAddress}`, leftX + width / 2 + 45, addrY + 12, { width: 200 });
    doc.text('GST No', leftX + width / 2 + 5, addrY + 36);
    doc.font('Helvetica-Bold').text(`: ${data.customerGst}`, leftX + width / 2 + 45, addrY + 36);
    doc.font('Helvetica').text('State', leftX + width / 2 + 5, addrY + 48);
    doc.text(': TAMILNADU', leftX + width / 2 + 45, addrY + 48);
    doc.text('Code : 33', leftX + width / 2 + 180, addrY + 48);

    y += 65;
    drawRowLine(y);

    // --- Table Header ---
    doc.rect(leftX, y, width, 18).fillColor('#f0f0f0').fill();
    doc.fillColor('black').font('Helvetica-Bold').fontSize(8);
    doc.text('S.NO', leftX + 2, y + 5, { width: 30, align: 'center' });
    doc.text('DESCRIPTION OF GOODS', leftX + 35, y + 5, { width: 230, align: 'center' });
    doc.text('SAC CODE', leftX + 265, y + 5, { width: 60, align: 'center' });
    doc.text('QTY', leftX + 325, y + 5, { width: 40, align: 'center' });
    doc.text('PRICE', leftX + 365, y + 5, { width: 70, align: 'center' });
    doc.text('AMOUNT (₹)', leftX + 435, y + 5, { width: 80, align: 'center' });

    y += 18;
    drawRowLine(y);

    // Table Column Vertical Lines
    const tableBottom = 500;
    const drawColLines = () => {
      doc.moveTo(leftX + 35, y - 18).lineTo(leftX + 35, tableBottom).stroke();
      doc.moveTo(leftX + 265, y - 18).lineTo(leftX + 265, tableBottom).stroke();
      doc.moveTo(leftX + 325, y - 18).lineTo(leftX + 325, tableBottom).stroke();
      doc.moveTo(leftX + 365, y - 18).lineTo(leftX + 365, tableBottom).stroke();
      doc.moveTo(leftX + 435, y - 18).lineTo(leftX + 435, tableBottom + 75).stroke();
    };
    drawColLines();

    // --- Table Body ---
    doc.font('Helvetica-Bold').fontSize(9);
    data.items.forEach((item, index) => {
      doc.text((index + 1).toString(), leftX + 2, y + 4, { width: 30, align: 'center' });
      doc.text(item.description, leftX + 40, y + 4, { width: 220 });
      doc.text(item.hsn || '84661010', leftX + 265, y + 4, { width: 60, align: 'center' });
      doc.text(item.quantity.toString(), leftX + 325, y + 4, { width: 40, align: 'center' });
      doc.text(item.price.toFixed(2), leftX + 365, y + 4, { width: 65, align: 'right' });
      doc.text(item.amount.toFixed(2), leftX + 435, y + 4, { width: 75, align: 'right' });
      y += 15;
      doc.moveTo(leftX, y).lineTo(rightX, y).stroke();
    });

    y = tableBottom;
    drawRowLine(y);

    // --- Totals ---
    doc.rect(leftX, y, width, 18).fillColor('#f0f0f0').fill();
    doc.fillColor('black').font('Helvetica-Bold').fontSize(10);
    doc.text('Total (Taxable Value)', leftX + 5, y + 4, { width: 320, align: 'right' });
    doc.text(data.items.reduce((sum, item) => sum + item.quantity, 0).toString(), leftX + 325, y + 4, { width: 40, align: 'center' });
    doc.text(data.subTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 }), leftX + 435, y + 4, { width: 75, align: 'right' });

    y += 18;
    drawRowLine(y);
    doc.fontSize(9).text('CGST (9%)', leftX + 5, y + 4, { width: 430, align: 'right' });
    doc.text((data.taxTotal / 2).toFixed(2), leftX + 435, y + 4, { width: 75, align: 'right' });
    y += 15;
    drawRowLine(y);
    doc.text('SGST (9%)', leftX + 5, y + 4, { width: 430, align: 'right' });
    doc.text((data.taxTotal / 2).toFixed(2), leftX + 435, y + 4, { width: 75, align: 'right' });
    y += 15;
    drawRowLine(y);

    doc.rect(leftX, y, width, 24).fillColor('#f0f0f0').fill();
    doc.fillColor('black').fontSize(13).text('GRAND TOTAL', leftX + 5, y + 6, { width: 430, align: 'right' });
    doc.text(data.grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 }), leftX + 435, y + 6, { width: 75, align: 'right' });
    y += 24;
    drawRowLine(y);

    // --- Bottom Sections ---
    y += 30;
    doc.fontSize(10).font('Helvetica-Bold').text(`AMOUNT (IN WORDS) : ${numberToWords(data.grandTotal).toUpperCase()}`, leftX + 5, y);
    y += 15;
    drawRowLine(y);

    doc.rect(leftX, y, width / 2, 15).fillColor('#f0f0f0').fill();
    doc.rect(leftX + width / 2, y, width / 2, 15).fillColor('#f0f0f0').fill();
    doc.fillColor('black').fontSize(9).text('Company Details', leftX, y + 3, { width: width / 2, align: 'center' });
    doc.text('Bank Details', leftX + width / 2, y + 3, { width: width / 2, align: 'center' });
    y += 15;
    drawRowLine(y);

    const footerY = y + 5;
    doc.fontSize(8);
    doc.font('Helvetica').text('VAT TIN', leftX + 5, footerY); doc.text(': 33132028969', leftX + 45, footerY);
    doc.text('CST NO', leftX + 5, footerY + 10); doc.text(': 1091562', leftX + 45, footerY + 10);
    doc.text('PAN NO', leftX + 5, footerY + 20); doc.text(': AAIFG6568K', leftX + 45, footerY + 20);

    doc.moveTo(leftX + width / 2, y).lineTo(leftX + width / 2, y + 40).stroke();
    doc.text('Bank', leftX + width / 2 + 5, footerY); doc.font('Helvetica-Bold').text(`: ${data.bankDetails.bankName}`, leftX + width / 2 + 45, footerY);
    doc.font('Helvetica').text('A/C No', leftX + width / 2 + 5, footerY + 10); doc.font('Helvetica-Bold').text(`: ${data.bankDetails.accNo}`, leftX + width / 2 + 45, footerY + 10);
    doc.font('Helvetica').text('IFSC', leftX + width / 2 + 5, footerY + 20); doc.font('Helvetica-Bold').text(`: ${data.bankDetails.ifsc}`, leftX + width / 2 + 45, footerY + 20);

    y += 40;
    drawRowLine(y);
    doc.fontSize(10).font('Helvetica-Bold').text('Receivers Sign :', leftX + 5, y + 5);
    doc.text(`For ${data.companyName}`, leftX + width / 2, y + 5, { width: width / 2, align: 'center' });

    y += 60;
    drawRowLine(y);

    // --- Declaration Footer ---
    doc.fontSize(7).font('Helvetica-Bold').text('Declaration:', leftX + 5, y + 5, { continued: true });
    doc.font('Helvetica').text('Supplied to Special Economic Zone-Duties & Taxes Are Exempted');
    doc.text('(Folio-No.8/3/2007 Suzlon ON INFRA SEZ DT.24.9.2007)');
    doc.text('UNDER EPCG LICENCE NO');
    doc.moveDown(1);
    doc.text('"Supply Meant For export/supply yo SEZ Unit or Sez developer for authorised', { align: 'center' });
    doc.text('Operations under Bond or Letter of Undertaking without Payment of Integrated Tax"', { align: 'center' });
    doc.text('(Export Covered Under LUT NO AD330625078562X v Dated 25/06/2025)', { align: 'center' });
    doc.moveDown(1);
    doc.text('Declartion: We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct');

    doc.end();
  });
};
