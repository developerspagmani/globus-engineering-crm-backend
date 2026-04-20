/**
 * Converts a number to words in Indian numbering system.
 * (e.g., 1,00,000 -> One Lakh)
 */
export const numberToWords = (num: number): string => {
  if (num === 0) return 'Zero';

  const a = [
    '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'
  ];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  const convert = (n: number): string => {
    if (n < 20) return a[n];
    if (n < 100) return b[Math.floor(n / 10)] + (n % 10 !== 0 ? ' ' + a[n % 10] : '');
    if (n < 1000) return a[Math.floor(n / 100)] + ' Hundred' + (n % 100 !== 0 ? ' and ' + convert(n % 100) : '');
    return '';
  };

  const lakh = Math.floor(num / 100000);
  const thousand = Math.floor((num % 100000) / 1000);
  const remainder = Math.floor(num % 1000);
  const crore = Math.floor(num / 10000000);

  let result = '';

  if (crore > 0) {
    result += convert(crore) + ' Crore ';
    num %= 10000000;
  }
  
  const currentLakh = Math.floor(num / 100000);
  if (currentLakh > 0) {
    result += convert(currentLakh) + ' Lakh ';
  }
  
  const currentThousand = Math.floor((num % 100000) / 1000);
  if (currentThousand > 0) {
    result += convert(currentThousand) + ' Thousand ';
  }
  
  const currentRemainder = Math.floor(num % 1000);
  if (currentRemainder > 0) {
    result += convert(currentRemainder);
  }

  return result.trim() + ' Only';
};
