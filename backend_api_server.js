// 必要なパッケージ: npm install express cors googleapis groq-sdk dotenv
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const Groq = require('groq-sdk');

const app = express();

// フロントエンドからのリクエストを許可 (GitHub PagesのURL等を環境変数で指定)
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json());

// Google OAuth2 クライアントの初期化
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.REDIRECT_URI || 'http://localhost:3000/auth/google/callback'
);

const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/presentations'
];

// 簡易的なセッション保持用（本番環境ではRedisやDB等の使用を推奨）
const tokenStore = {}; 

// 1. Google ログインURLの発行
app.get('/auth/google', (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent'
  });
  res.redirect(url);
});

// 2. Google ログイン後のコールバック処理
app.get('/auth/google/callback', async (req, res) => {
  const { code } = req.query;
  try {
    const { tokens } = await oauth2Client.getToken(code);
    // デモ用: 簡易的にメモリに保存。通常はセッションID等を発行してCookieで管理します
    tokenStore['demo_user'] = tokens; 
    
    // フロントエンドへリダイレクトして完了を通知
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5500';
    res.redirect(`${frontendUrl}?auth=success`);
  } catch (error) {
    console.error('OAuth Error:', error);
    res.status(500).send('Authentication failed');
  }
});

// 3. Groq生成 & Google Workspace連携メインAPI
app.post('/api/generate-and-sync', async (req, res) => {
  const { type, prompt, groqApiKey, groqModel, systemPrompt } = req.body;

  // トークンの確認
  const tokens = tokenStore['demo_user'];
  if (!tokens) {
    return res.status(401).json({ error: 'Googleアカウントでログインしていません' });
  }

  oauth2Client.setCredentials(tokens);
  
  try {
    // -----------------------------------------------------
    // ① Groq API でコンテンツを生成 (バックグラウンド処理)
    // -----------------------------------------------------
    const groq = new Groq({ apiKey: groqApiKey || process.env.GROQ_API_KEY });
    
    const completion = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt || 'あなたは優秀なアシスタントです。' },
        { role: 'user', content: prompt }
      ],
      model: groqModel || 'llama-3.3-70b-versatile',
      temperature: 0.7,
    });

    const generatedText = completion.choices[0]?.message?.content || '';

    // -----------------------------------------------------
    // ② 生成されたテキストを Google Workspace へ保存
    // -----------------------------------------------------
    let resultUrl = '';
    let resultTitle = '';

    if (type === 'docs') {
      const docs = google.docs({ version: 'v1', auth: oauth2Client });
      const doc = await docs.documents.create({ requestBody: { title: `自動生成ドキュメント_${Date.now()}` } });
      
      await docs.documents.batchUpdate({
        documentId: doc.data.documentId,
        requestBody: {
          requests: [{ insertText: { location: { index: 1 }, text: generatedText } }]
        }
      });
      resultUrl = `https://docs.google.com/document/d/${doc.data.documentId}/edit`;
      resultTitle = doc.data.title;

    } else if (type === 'sheets') {
      const sheets = google.sheets({ version: 'v4', auth: oauth2Client });
      const spreadsheet = await sheets.spreadsheets.create({
        requestBody: { properties: { title: `自動生成シート_${Date.now()}` } }
      });
      
      // テキストを行ごとに簡易分割してスプレッドシートに書き込み
      const rows = generatedText.split('\n').map(line => [line]);
      await sheets.spreadsheets.values.update({
        spreadsheetId: spreadsheet.data.spreadsheetId,
        range: 'Sheet1!A1',
        valueInputOption: 'RAW',
        requestBody: { values: rows }
      });
      resultUrl = spreadsheet.data.spreadsheetUrl;
      resultTitle = spreadsheet.data.properties.title;

    } else if (type === 'slides') {
      // スライドは構造が複雑なため、今回は空のプレゼンを作成し、ノート部分等に記載する想定
      const slides = google.slides({ version: 'v1', auth: oauth2Client });
      const presentation = await slides.presentations.create({
        requestBody: { title: `自動生成スライド_${Date.now()}` }
      });
      resultUrl = `https://docs.google.com/presentation/d/${presentation.data.presentationId}/edit`;
      resultTitle = presentation.data.title;
    }

    // 成功レスポンスをフロントエンドに返す
    res.json({
      success: true,
      text: generatedText,
      workspaceUrl: resultUrl,
      workspaceTitle: resultTitle
    });

  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});