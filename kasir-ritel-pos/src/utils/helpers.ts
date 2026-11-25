export const formatRupiah = (angka: number): string => {
  return 'Rp ' + Math.round(angka).toLocaleString('id-ID');
};

export async function hashTextSHA256(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function generateBarcode(existingBarcodes: string[]): string {
  let generated = '';
  do {
    const randomDigits = Math.floor(100000 + Math.random() * 900000);
    generated = '899' + randomDigits;
  } while (existingBarcodes.includes(generated));
  return generated;
}