const API_URL = '/api';

export async function generateImage({ prompt, ratio }) {
  const res = await fetch(`${API_URL}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, ratio }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function generateImageToImage({ base64Image, prompt, ratio }) {
  const res = await fetch(`${API_URL}/image-to-image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base64Image, prompt, ratio }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
