import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Generates the next sequence number by querying the table for the highest numeric suffix.
 * Preserves the prefix and any zero-padding of the highest existing sequence.
 * 
 * @param tableName The raw table name in the database (e.g., 'app_inward_entries')
 * @param fieldName The column name (e.g., 'inward_no')
 * @param defaultPrefix The default prefix to use if no existing records are found
 */
export async function generateNextSequence(
  tableName: string,
  fieldName: string,
  defaultPrefix: string = '',
  companyId?: string | null,
  defaultStartNum: number = 1901
): Promise<string> {
  try {
    // Fetch all non-empty values of this field to find the highest number
    let query = `SELECT ${fieldName} as doc_no FROM ${tableName} WHERE ${fieldName} IS NOT NULL AND ${fieldName} != ''`;
    if (companyId) {
      const sanitizedCompanyId = String(companyId).replace(/'/g, "''");
      query += ` AND company_id = '${sanitizedCompanyId}'`;
    }
    const records = await prisma.$queryRawUnsafe<any[]>(query);

    let maxNum = 0;
    let foundPrefix = defaultPrefix;
    let paddingLength = 0;

    for (const record of records) {
      if (!record.doc_no) continue;
      
      const docNo = String(record.doc_no).trim();
      
      // Match a string that ends with one or more digits.
      // group 1: prefix (everything before the digits)
      // group 2: digits
      const match = docNo.match(/^(.*?)(\d+)$/);
      if (match) {
        const prefix = match[1];
        const numStr = match[2];
        const num = parseInt(numStr, 10);
        
        if (!isNaN(num) && num > maxNum) {
          maxNum = num;
          foundPrefix = prefix;
          paddingLength = numStr.length;
        }
      }
    }

    if (maxNum === 0) {
      // If we couldn't find any existing numeric sequence, start with 1901
      // as the user mentioned: "even 1900 next genrating should be 1901"
      return `${defaultPrefix}${defaultStartNum}`;
    }

    const nextNum = maxNum + 1;
    const nextNumStr = String(nextNum);
    
    // Preserve leading zeros if any (e.g. 001 -> 002)
    const finalNumStr = paddingLength > nextNumStr.length 
      ? nextNumStr.padStart(paddingLength, '0') 
      : nextNumStr;

    const prefixToUse = defaultPrefix !== '' ? defaultPrefix : foundPrefix;
    return `${prefixToUse}${finalNumStr}`;
  } catch (error) {
    console.error(`Error generating sequence for ${tableName}.${fieldName}:`, error);
    // Fallback to timestamp if query fails
    return `${defaultPrefix}${Date.now()}`;
  }
}
