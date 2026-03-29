export default async function handler(req, res) {
  // 1. Get the secret URL from Vercel Environment Variables
  const SHEET_URL = process.env.REAL_SHEET_URL;

  if (!SHEET_URL) {
    return res.status(500).json({ error: "Server configuration missing" });
  }

  try {
    // 2. The server fetches the data from Google
    const response = await fetch(SHEET_URL);
    const data = await response.text();

    // 3. Send the data back to your app.js
    res.setHeader('Content-Type', 'text/csv');
    res.status(200).send(data);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch data" });
  }
}