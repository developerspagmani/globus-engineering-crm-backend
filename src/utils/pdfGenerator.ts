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
  taxRate?: number;
  state?: string;
  billType?: string;

  // Custom Company Details (dynamic from DB)
  companyName?: string;
  companySubHeader?: string;
  companyAddress?: string;
  companyGst?: string;
  vatTin?: string;
  cstNo?: string;
  panNo?: string;
  bankName?: string;
  bankAcc?: string;
  bankBranchIfsc?: string;
  declarationText?: string;
  showDeclaration?: boolean;
  logo?: string;
  logoSecondary?: string;
}

// Helper to extract Buffer from base64 data URI
const getBase64Buffer = (dataUri: string): Buffer | null => {
  if (!dataUri || !dataUri.startsWith('data:image')) return null;
  try {
    const parts = dataUri.split(';base64,');
    if (parts.length === 2) {
      return Buffer.from(parts[1], 'base64');
    }
  } catch (err) {
    console.error('Error parsing base64 data URI:', err);
  }
  return null;
};

// Date formatter helper (DD-MM-YYYY)
const formatDate = (dateStr: string) => {
  if (!dateStr || dateStr === 'N/A') return '';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}-${month}-${year}`;
  } catch {
    return dateStr;
  }
};

export const generateInvoicePDF = (data: InvoicePDFData): Promise<Buffer> => {
  return new Promise((resolve, reject) => {
    // 1. Pagination Config (Identical to Frontend)
    const GLOBAL_PAGE_CAPACITY = 18;
    const FOOTER_SPACE_ROWS = 7;

    const paginate = (items: any[]) => {
      let result: any[][] = [];
      let remaining = [...items];
      if (remaining.length === 0) return [[]];

      while (remaining.length > 0) {
        if (remaining.length <= (GLOBAL_PAGE_CAPACITY - FOOTER_SPACE_ROWS)) {
          result.push(remaining);
          remaining = [];
        } else if (remaining.length <= GLOBAL_PAGE_CAPACITY) {
          result.push(remaining);
          remaining = [];
        } else {
          result.push(remaining.slice(0, GLOBAL_PAGE_CAPACITY));
          remaining = remaining.slice(GLOBAL_PAGE_CAPACITY);
        }
      }
      return result;
    };

    const pagesData = paginate(data.items);
    const totalPages = pagesData.length;

    // Create the pdf document
    const doc = new PDFDocument({ size: 'A4', margin: 0 });
    const chunks: any[] = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // --- Layout Constants ---
    const leftX = 40;
    const rightX = 555;
    const width = rightX - leftX; // 515

    // Determine clean billType and parameters
    const billTypeClean = (data.billType || '').toLowerCase();
    const isWOP = billTypeClean.includes('without') || billTypeClean === 'wop' || billTypeClean === 'without_process';
    
    // State and State code determination
    const targetState = data.state || 'Tamilnadu';
    const isIntraState = targetState.toLowerCase().replace(/[^a-z]/g, '') === 'tamilnadu';
    const taxRate = data.taxRate || 18;
    const recipientCode = targetState.toLowerCase().replace(/[^a-z]/g, '') === 'telangana' ? '36' : (isIntraState ? '33' : '33'); // default recipient state code to 33 if tamilnadu/other
    const stateLabel = isIntraState ? 'TamilNadu-33' : `${targetState.charAt(0).toUpperCase() + targetState.slice(1)}-${recipientCode}`;

    // Format currency function
    const formatCurrency = (val: number) => {
      return val.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    // Render loop for pages
    pagesData.forEach((pageItems, pageIdx) => {
      const isLastPage = pageIdx === totalPages - 1;
      const startSno = pagesData.slice(0, pageIdx).reduce((sum, p) => sum + p.length, 0) + 1;

      if (pageIdx > 0) {
        doc.addPage({ size: 'A4', margin: 0 });
      }

      // Set line width
      doc.lineWidth(0.8);
      doc.strokeColor('black');

      // Draw Top Page Border Box Line
      doc.moveTo(leftX, 40).lineTo(rightX, 40).stroke();

      // --- 1. Top Header Section ---
      // Helper vector logos
      const drawVectorOctagonLogo = () => {
        doc.save();
        doc.translate(55, 55);
        const scale = 0.5;
        doc.scale(scale);
        doc.path('M25 5 L75 5 L95 25 L95 75 L75 95 L25 95 L5 75 L5 25 Z').stroke();
        doc.circle(50, 50, 28).stroke();
        doc.path('M50 20 L50 10 M50 80 L50 90 M20 50 L10 50 M80 50 L90 50').stroke();
        doc.fontSize(32).font('Helvetica-Bold').text('S', 34, 40, { width: 32, align: 'center' });
        doc.restore();
      };

      const drawVectorTuvLogo = () => {
        doc.rect(480, 50, 60, 60).stroke();
        doc.fontSize(8).font('Helvetica-Bold').text('Q', 480, 52, { width: 60, align: 'center' });
        doc.moveTo(480, 62).lineTo(540, 62).stroke();
        doc.fontSize(16).text('TÜV', 480, 70, { width: 60, align: 'center' });
        doc.fontSize(10).text('SÜD', 480, 85, { width: 60, align: 'center' });
        doc.moveTo(480, 100).lineTo(540, 100).stroke();
        doc.fontSize(7).text('ISO 9001', 480, 103, { width: 60, align: 'center' });
      };

      // Draw Left Logo
      const leftLogoBuffer = data.logo ? getBase64Buffer(data.logo) : null;
      if (leftLogoBuffer) {
        try {
          doc.image(leftLogoBuffer, 50, 50, { fit: [60, 60], align: 'center', valign: 'center' });
        } catch (err) {
          console.error('Error rendering left logo image:', err);
          drawVectorOctagonLogo();
        }
      } else {
        drawVectorOctagonLogo();
      }

      // Center Text
      const displayCompanyName = (data.companyName || 'GLOBUS ENGINEERING TOOLS').toUpperCase();
      const displaySubHeader = data.companySubHeader || 'No 24,Annaiyappan Street,S.S.Nagar, Nallampalayam,Ganapathy Post, Coimbatore-641006.';
      const displayAddress = data.companyAddress || 'No 24,Annaiyappan Street,S.S.Nagar, Nallampalayam,Ganapathy Post, Coimbatore-641006.';

      doc.fontSize(18).font('Helvetica-Bold').fillColor('black').text(displayCompanyName, 130, 65, { width: 330, align: 'center' });
      doc.fontSize(8.5).font('Helvetica-Bold').text(displaySubHeader, 130, 85, { width: 330, align: 'center' });

      // Draw Right Logo
      const rightLogoBuffer = data.logoSecondary ? getBase64Buffer(data.logoSecondary) : null;
      if (rightLogoBuffer) {
        try {
          doc.image(rightLogoBuffer, 480, 50, { fit: [60, 60], align: 'center', valign: 'center' });
        } catch (err) {
          console.error('Error rendering right logo image:', err);
          drawVectorTuvLogo();
        }
      } else {
        drawVectorTuvLogo();
      }

      doc.moveTo(leftX, 120).lineTo(rightX, 120).stroke();

      // --- 2. Meta Grid Section ---
      let y = 120;
      doc.fontSize(7.5).font('Helvetica');
      const drawCol = (colX: number, label: string, val: string) => {
        doc.font('Helvetica').text(label, colX + 5, y + 4);
        doc.font('Helvetica-Bold').text(`: ${val}`, colX + 60, y + 4);
        if (colX > leftX) {
          doc.moveTo(colX, y).lineTo(colX, y + 15).stroke();
        }
      };

      drawCol(leftX, isWOP ? 'Invoice WOP No' : 'Invoice No', data.invoiceNumber);
      drawCol(leftX + 130, 'DC No', data.dcNo);
      drawCol(leftX + 260, 'PO No', data.poNo);
      drawCol(leftX + 390, 'State', stateLabel);

      y += 15;
      doc.moveTo(leftX, y).lineTo(rightX, y).stroke();
      drawCol(leftX, 'Invoice Date', formatDate(data.invoiceDate));
      drawCol(leftX + 130, 'DC Date', formatDate(data.dcDate));
      drawCol(leftX + 260, 'PO Date', formatDate(data.poDate));
      drawCol(leftX + 390, 'Reverse Charge', 'N');

      y += 15;
      doc.moveTo(leftX, y).lineTo(rightX, y).stroke();

      // --- 3. TAX INVOICE BAR ---
      doc.rect(leftX, y, width, 18).fillColor('#f0f0f0').fill();
      doc.fillColor('black').font('Helvetica-Bold').fontSize(11).text(isWOP ? 'INVOICE WOP' : 'TAX INVOICE', leftX, y + 4, { align: 'center' });
      y += 18;
      doc.moveTo(leftX, y).lineTo(rightX, y).stroke();

      // --- 4. Address Section ---
      // Background title bar
      doc.rect(leftX, y, width / 2, 15).fillColor('#e9e9e9').fill();
      doc.rect(leftX + width / 2, y, width / 2, 15).fillColor('#e9e9e9').fill();
      doc.fillColor('black').fontSize(8).font('Helvetica-Bold').text('SUPPLIER DETAILS :', leftX + 5, y + 4);
      doc.text('RECEIPIENTS DETAILS :', leftX + width / 2 + 5, y + 4);

      y += 15;
      doc.moveTo(leftX, y).lineTo(rightX, y).stroke();

      // Content addresses
      const addrY = y + 5;
      doc.fontSize(8.5).font('Helvetica');
      // Supplier Details
      doc.text('Name', leftX + 5, addrY);
      doc.font('Helvetica-Bold').text(`: ${displayCompanyName}`, leftX + 50, addrY);
      doc.font('Helvetica').text('Address', leftX + 5, addrY + 12);
      doc.text(`: ${displayAddress.toUpperCase()}`, leftX + 50, addrY + 12, { width: 200, lineGap: 1 });
      doc.text('GST No', leftX + 5, addrY + 40);
      doc.font('Helvetica-Bold').text(`: ${data.companyGst || '33AAIFG6568K1ZZ'}`, leftX + 50, addrY + 40);
      doc.font('Helvetica').text('State', leftX + 5, addrY + 52);
      doc.text(': Tamilnadu', leftX + 50, addrY + 52);
      doc.text('Code : 33', leftX + 180, addrY + 52);

      // Recipient Details
      doc.font('Helvetica').text('Name', leftX + width / 2 + 5, addrY);
      doc.font('Helvetica-Bold').text(`: ${data.customerName}`, leftX + width / 2 + 50, addrY);
      doc.font('Helvetica').text('Address', leftX + width / 2 + 5, addrY + 12);
      doc.text(`: ${(data.customerAddress || 'N/A').toUpperCase()}`, leftX + width / 2 + 50, addrY + 12, { width: 200, lineGap: 1 });
      doc.text('GST No', leftX + width / 2 + 5, addrY + 40);
      doc.font('Helvetica-Bold').text(`: ${data.customerGst || 'N/A'}`, leftX + width / 2 + 50, addrY + 40);
      doc.font('Helvetica').text('State', leftX + width / 2 + 5, addrY + 52);
      doc.text(`: ${(data.state || 'N/A').toUpperCase()}`, leftX + width / 2 + 50, addrY + 52);
      doc.text(`Code : ${recipientCode}`, leftX + width / 2 + 180, addrY + 52);

      // Vertical line separating supplier & recipient
      doc.moveTo(leftX + width / 2, y).lineTo(leftX + width / 2, y + 65).stroke();

      y += 65;
      doc.moveTo(leftX, y).lineTo(rightX, y).stroke();

      // --- 5. Table Header ---
      doc.rect(leftX, y, width, 18).fillColor('#e9e9e9').fill();
      doc.fillColor('black').font('Helvetica-Bold').fontSize(8.5);

      if (isWOP) {
        doc.text('S.No', leftX, y + 5, { width: 40, align: 'center' });
        doc.text('Description', leftX + 40, y + 5, { width: 335, align: 'center' });
        doc.text('HSN Code', leftX + 375, y + 5, { width: 80, align: 'center' });
        doc.text('Qty', leftX + 455, y + 5, { width: 60, align: 'center' });
      } else {
        doc.text('S.No', leftX, y + 5, { width: 30, align: 'center' });
        doc.text('Description', leftX + 30, y + 5, { width: 195, align: 'center' });
        doc.text('HSN Code', leftX + 225, y + 5, { width: 60, align: 'center' });
        doc.text('GST Rate', leftX + 285, y + 5, { width: 50, align: 'center' });
        doc.text('Qty', leftX + 335, y + 5, { width: 40, align: 'center' });
        doc.text('Price', leftX + 375, y + 5, { width: 65, align: 'center' });
        doc.text('Amount (Rs.)', leftX + 440, y + 5, { width: 75, align: 'center' });
      }

      y += 18;
      doc.moveTo(leftX, y).lineTo(rightX, y).stroke();

      // --- 6. Table Body Rows (Items and Fillers) ---
      const yTableStart = y - 18; // start of table header for vertical dividers
      
      const targetRows = isLastPage ? (GLOBAL_PAGE_CAPACITY - FOOTER_SPACE_ROWS) : GLOBAL_PAGE_CAPACITY;
      const fillerCount = Math.max(0, targetRows - pageItems.length);
      const totalRowsCount = pageItems.length + fillerCount;

      doc.fontSize(8.5).font('Helvetica-Bold');
      for (let i = 0; i < totalRowsCount; i++) {
        const isFiller = i >= pageItems.length;
        const item = !isFiller ? pageItems[i] : null;

        if (!isFiller && item) {
          const sNoText = (startSno + i).toString();
          const descText = item.description || 'N/A';
          const hsnText = item.hsn || '84661010';
          const qtyText = item.quantity.toString();

          if (isWOP) {
            doc.text(sNoText, leftX, y + 4, { width: 40, align: 'center' });
            doc.text(descText, leftX + 45, y + 4, { width: 325, height: 11, ellipsis: true });
            doc.text(hsnText, leftX + 375, y + 4, { width: 80, align: 'center' });
            doc.text(qtyText, leftX + 455, y + 4, { width: 60, align: 'center' });
          } else {
            const gstRateText = `${taxRate}%`;
            const priceText = (item.price || 0).toFixed(2);
            const amountText = (item.amount || 0).toFixed(2);

            doc.text(sNoText, leftX, y + 4, { width: 30, align: 'center' });
            doc.text(descText, leftX + 35, y + 4, { width: 185, height: 11, ellipsis: true });
            doc.text(hsnText, leftX + 225, y + 4, { width: 60, align: 'center' });
            doc.text(gstRateText, leftX + 285, y + 4, { width: 50, align: 'center' });
            doc.text(qtyText, leftX + 335, y + 4, { width: 40, align: 'center' });
            doc.text(priceText, leftX + 375, y + 4, { width: 60, align: 'right' });
            doc.text(amountText, leftX + 440, y + 4, { width: 70, align: 'right' });
          }
        } else {
          // Filler blank lines
          if (isWOP) {
            doc.text('', leftX, y + 4, { width: 40 });
          } else {
            doc.text('', leftX, y + 4, { width: 30 });
          }
        }

        y += 15;
        doc.moveTo(leftX, y).lineTo(rightX, y).stroke();
      }

      // Draw Vertical Table Column Lines
      const yTableEnd = y;
      if (isWOP) {
        doc.moveTo(leftX + 40, yTableStart).lineTo(leftX + 40, yTableEnd).stroke();
        doc.moveTo(leftX + 375, yTableStart).lineTo(leftX + 375, yTableEnd).stroke();
        doc.moveTo(leftX + 455, yTableStart).lineTo(leftX + 455, yTableEnd).stroke();
      } else {
        doc.moveTo(leftX + 30, yTableStart).lineTo(leftX + 30, yTableEnd).stroke();
        doc.moveTo(leftX + 225, yTableStart).lineTo(leftX + 225, yTableEnd).stroke();
        doc.moveTo(leftX + 285, yTableStart).lineTo(leftX + 285, yTableEnd).stroke();
        doc.moveTo(leftX + 335, yTableStart).lineTo(leftX + 335, yTableEnd).stroke();
        doc.moveTo(leftX + 375, yTableStart).lineTo(leftX + 375, yTableEnd).stroke();
        doc.moveTo(leftX + 440, yTableStart).lineTo(leftX + 440, yTableEnd).stroke();
      }

      // --- 7. Totals & Footer Section (Last Page Only) ---
      if (isLastPage) {
        // Total Row
        doc.rect(leftX, y, width, 18).fillColor('#f0f0f0').fill();
        doc.fillColor('black').font('Helvetica-Bold').fontSize(9.5);

        if (isWOP) {
          doc.text('Total Quantity', leftX + 5, y + 4, { width: 450, align: 'right' });
          const totalQty = data.items.reduce((sum, it) => sum + it.quantity, 0);
          doc.text(totalQty.toString(), leftX + 455, y + 4, { width: 60, align: 'center' });
          y += 18;
          doc.moveTo(leftX, y).lineTo(rightX, y).stroke();
        } else {
          doc.text('Total (Taxable Value)', leftX + 5, y + 4, { width: 330, align: 'right' });
          const totalQty = data.items.reduce((sum, it) => sum + it.quantity, 0);
          doc.text(totalQty.toString(), leftX + 335, y + 4, { width: 40, align: 'center' });
          doc.text(formatCurrency(data.subTotal), leftX + 440, y + 4, { width: 70, align: 'right' });
          
          y += 18;
          doc.moveTo(leftX, y).lineTo(rightX, y).stroke();

          // GST rows
          doc.fontSize(8.5);
          if (isIntraState) {
            doc.text(`CGST (${taxRate / 2}%)`, leftX + 5, y + 4, { width: 435, align: 'right' });
            doc.text((data.taxTotal / 2).toFixed(2), leftX + 440, y + 4, { width: 70, align: 'right' });
            y += 15;
            doc.moveTo(leftX, y).lineTo(rightX, y).stroke();

            doc.text(`SGST (${taxRate / 2}%)`, leftX + 5, y + 4, { width: 435, align: 'right' });
            doc.text((data.taxTotal / 2).toFixed(2), leftX + 440, y + 4, { width: 70, align: 'right' });
            y += 15;
            doc.moveTo(leftX, y).lineTo(rightX, y).stroke();
          } else {
            doc.text(`IGST (${taxRate}%)`, leftX + 5, y + 4, { width: 435, align: 'right' });
            doc.text(data.taxTotal.toFixed(2), leftX + 440, y + 4, { width: 70, align: 'right' });
            y += 15;
            doc.moveTo(leftX, y).lineTo(rightX, y).stroke();
          }

          // Grand Total Row
          doc.rect(leftX, y, width, 24).fillColor('#f0f0f0').fill();
          doc.fillColor('black').fontSize(11).font('Helvetica-Bold');
          doc.text('GRAND TOTAL', leftX + 5, y + 6, { width: 430, align: 'right' });
          doc.text(formatCurrency(data.grandTotal), leftX + 440, y + 6, { width: 70, align: 'right' });
          y += 24;
          doc.moveTo(leftX, y).lineTo(rightX, y).stroke();
        }

        // Amount in words (non-WOP only)
        if (!isWOP) {
          doc.fontSize(8.5).font('Helvetica');
          doc.text('Amount (in words) : ', leftX + 12, y + 4, { continued: true });
          doc.font('Helvetica-Bold').text(numberToWords(data.grandTotal).toUpperCase());
          y += 15;
          doc.moveTo(leftX, y).lineTo(rightX, y).stroke();

          // Details Row (Company + Bank details)
          doc.rect(leftX, y, width / 2, 15).fillColor('#e9e9e9').fill();
          doc.rect(leftX + width / 2, y, width / 2, 15).fillColor('#e9e9e9').fill();
          doc.fillColor('black').font('Helvetica-Bold').fontSize(9);
          doc.text('Company Details', leftX, y + 3, { width: width / 2, align: 'center' });
          doc.text('Bank Details', leftX + width / 2, y + 3, { width: width / 2, align: 'center' });

          y += 15;
          doc.moveTo(leftX, y).lineTo(rightX, y).stroke();

          const detailContentY = y + 5;
          doc.fontSize(8).font('Helvetica');
          // Company details content
          doc.text('VAT TIN', leftX + 10, detailContentY); doc.text(`: ${data.vatTin || '33132028969'}`, leftX + 50, detailContentY);
          doc.text('CST NO', leftX + 10, detailContentY + 10); doc.text(`: ${data.cstNo || '1091562'}`, leftX + 50, detailContentY + 10);
          doc.text('PAN NO', leftX + 10, detailContentY + 20); doc.text(`: ${data.panNo || 'AAIFG6568K'}`, leftX + 50, detailContentY + 20);

          // Bank details content
          doc.text('Bank', leftX + width / 2 + 10, detailContentY); doc.font('Helvetica-Bold').text(`: ${data.bankName || 'INDIAN OVERSEAS BANK'}`, leftX + width / 2 + 50, detailContentY);
          doc.font('Helvetica').text('A/C No', leftX + width / 2 + 10, detailContentY + 10); doc.font('Helvetica-Bold').text(`: ${data.bankAcc || '170902000000962'}`, leftX + width / 2 + 50, detailContentY + 10);
          doc.font('Helvetica').text('IFSC', leftX + width / 2 + 10, detailContentY + 20); doc.font('Helvetica-Bold').text(`: ${data.bankBranchIfsc || 'IOBA0001709'}`, leftX + width / 2 + 50, detailContentY + 20);

          // Vertical divider line
          doc.moveTo(leftX + width / 2, y).lineTo(leftX + width / 2, y + 40).stroke();

          y += 40;
          doc.moveTo(leftX, y).lineTo(rightX, y).stroke();
        }

        // Signatures Row
        const sigY = y + 5;
        doc.fontSize(9.5).font('Helvetica-Bold');
        doc.text('Receivers Sign :', leftX + 10, sigY);
        doc.text(`FOR ${displayCompanyName}`, leftX + width / 2, sigY, { width: width / 2, align: 'center' });

        y += 60;
        doc.moveTo(leftX, y).lineTo(rightX, y).stroke();

        // Declaration Footer
        const showDeclaration = data.showDeclaration !== undefined ? data.showDeclaration : true;
        if (showDeclaration) {
          const decText = data.declarationText || 
            `Declaration: Supplied to Special Economic Zone-Duties & Taxes Are Exempted\n(Folio-No.8/3/2007 Suzlon ON INFRA SEZ DT.24.9.2007)\nUNDER EPCG LICENCE NO\n\n"Supply Meant For export/supply to SEZ Unit or Sez developer for authorised\nOperations under Bond or Letter of Undertaking without Payment of Integrated Tax"\n(Export Covered Under LUT NO AD330625078562X v Dated 25/06/2025)\n\nDeclaration: We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct`;

          doc.fontSize(7).font('Helvetica').fillColor('black');
          doc.text(decText, leftX + 10, y + 5, { width: width - 20, align: 'center', lineGap: 1.5 });
          y = doc.y + 8;
        }
      }

      // Draw Left, Right, and Bottom Page Borders around all content on the page
      const finalY = y;
      doc.moveTo(leftX, 40).lineTo(leftX, finalY).stroke();
      doc.moveTo(rightX, 40).lineTo(rightX, finalY).stroke();
      doc.moveTo(leftX, finalY).lineTo(rightX, finalY).stroke();

      // Page Numbering Indicator at bottom right
      doc.fontSize(7.5).font('Helvetica-Bold').fillColor('gray');
      doc.text(`Page ${pageIdx + 1} of ${totalPages}`, rightX - 80, finalY + 12, { width: 80, align: 'right' });
    });

    doc.end();
  });
};
