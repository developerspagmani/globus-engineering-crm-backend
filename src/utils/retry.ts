/**
 * Utility to retry a function multiple times with exponential backoff
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  retries: number = 3,
  delay: number = 1000
): Promise<T> {
  let lastError: any;
  
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      // Only retry on connection related errors
      const isConnectionError = 
        error.message.includes('Can\'t reach database server') ||
        error.message.includes('Connection pool timeout') ||
        error.message.includes('Can\'t connect to the database') ||
        error.code === 'P1001' ||
        error.code === 'P1008';

      if (!isConnectionError) throw error;
      
      console.warn(`Database connection attempt ${i + 1} failed. Retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      delay *= 2; // Exponential backoff
    }
  }
  
  throw lastError;
}
