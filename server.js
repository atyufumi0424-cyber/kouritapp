const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const { Groq } = require('groq-sdk'); // Groqを使用している場合

const app = express();
app.use(cors());
app.use(express.json());

// 環境変数の読み込み
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// OAuth2 クライアントの設定
const oauth2Client = new google.auth.OAuth2(
    CLIENT_ID,
    CLIENT_SECRET,
    REDIRECT_URI
);

// Groq SDKの設定
const groq = new Groq({ apiKey: GROQ_API_KEY });

// 1. Google ログインURLの発行
app.get('/auth/google', (req, res) => {
    const scopes = [
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/documents',
        'https://www.googleapis.com/auth/spreadsheets'
    ];
    const url = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: scopes,
        prompt: 'consent'
    });
    res.redirect(url);
});

// 2. Google 認証後のコールバック処理
app.get('/auth/google/callback', async (req, res) => {
    const { code } = req.query;
    try {
        const { tokens } = await oauth2Client.getToken(code);
        // 認証成功時、フロントエンド（GitHub Pages）へアクセストークンを渡してリダイレクト
        const frontendUrl = process.env.FRONTEND_URL || 'https://atyufumi0424-cyber.github.io/kouritapp/';
        res.redirect(`${frontendUrl}?access_token=${tokens.access_token}`);
    } catch (error) {
        console.error('OAuth Error:', error);
        res.status(500).send('Google Authentication Failed');
    }
});

// 3. ツール（Docs / Sheets）新規作成 API
app.post('/api/create-tool', async (req, res) => {
    const { accessToken, toolType, topic } = req.body;
    if (!accessToken) return res.status(401).json({ error: 'No access token' });

    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });

    try {
        let fileUrl = '';
        const title = `【課題】${topic || '学習ノート'}`;

        if (toolType && (toolType.includes('Sheet') || toolType.includes('シート'))) {
            // Google Sheets の作成
            const sheets = google.sheets({ version: 'v4', auth });
            const response = await sheets.spreadsheets.create({
                requestBody: { properties: { title } }
            });
            fileUrl = `https://docs.google.com/spreadsheets/d/${response.data.spreadsheetId}/edit?rm=embedded`;
        } else {
            // デフォルト: Google Docs の作成
            const docs = google.docs({ version: 'v1', auth });
            const response = await docs.documents.create({
                requestBody: { title }
            });
            fileUrl = `https://docs.google.com/document/d/${response.data.documentId}/edit?rm=embedded`;
        }

        res.json({ embedUrl: fileUrl });
    } catch (error) {
        console.error('Create Tool Error:', error);
        res.status(500).json({ error: 'Failed to create tool file' });
    }
});

// 4. AI チャット API
app.post('/api/chat', async (req, res) => {
    const { message } = req.body;
    try {
        const completion = await groq.chat.completions.create({
            messages: [{ role: 'user', content: message }],
            model: 'llama-3.3-70b-versatile',
        });
        const reply = completion.choices[0]?.message?.content || '応答を取得できませんでした。';
        res.json({ reply });
    } catch (error) {
        console.error('AI Error:', error);
        res.status(500).json({ reply: 'AIサーバーでエラーが発生しました。' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
