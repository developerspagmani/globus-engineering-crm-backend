import { Response, Request } from 'express';
import { AuthRequest } from '../../middleware/authMiddleware';

export const getGstDetails = async (req: Request, res: Response) => {
  const { gstin: rawGstin } = req.query;
  const gstin = String(rawGstin).toUpperCase();

  if (!gstin || gstin.length !== 15) {
    return res.status(400).json({ error: 'Valid 15-digit GSTIN is required' });
  }

  try {
    // Masters India Public Search API Configuration
    const uniqueId = 'K3nUOh0Sn0ZpqtfxbBcWY2M6GBnRat'; 
    const url = `https://blog-backend.mastersindia.co/api/v1/custom/search/gstin/?keyword=${gstin}&unique_id=${uniqueId}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Origin': 'https://www.mastersindia.co',
        'Referer': 'https://www.mastersindia.co/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
      }
    });

    const result: any = await response.json();

    // Masters India API usually returns data in result.data
    const gstData = result.data || result;

    if (!response.ok || !gstData || (!gstData.legal_name && !gstData.lgnm)) {
      return res.status(404).json({ 
        error: 'No record found for this GSTIN. Please check the number and try again.' 
      });
    }

    res.json({
      success: true,
      data: {
        legal_name: gstData.legal_name || gstData.lgnm || "N/A",
        trade_name: gstData.trade_name || gstData.trade_business_name || gstData.txn || "N/A",
        status: gstData.status || gstData.sts || "Active",
        registration_date: gstData.registration_date || gstData.rgdt || "N/A",
        business_type: gstData.business_type || gstData.ctb || "N/A",
        taxpayer_type: gstData.taxpayer_type || gstData.dty || "Regular",
        address: gstData.address || (gstData.pradr?.addr ? `${gstData.pradr.addr.bnm || ''} ${gstData.pradr.addr.st || ''}, ${gstData.pradr.addr.loc || ''}, ${gstData.pradr.addr.dst || ''}` : "View on Portal"),
        state_jurisdiction: gstData.state_jurisdiction || gstData.stj || "N/A",
        center_jurisdiction: gstData.center_jurisdiction || gstData.ctj || "N/A",
        gstin: gstin
      }
    });
  } catch (error: any) {
    console.error("GST API Error:", error.message);
    res.status(500).json({ error: 'Verification failed. External service may be currently unavailable.' });
  }
};
