const express = require("express");
const line = require("@line/bot-sdk");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const lineConfig = {
  channelSecret: LINE_CHANNEL_SECRET,
  channelAccessToken: LINE_CHANNEL_ACCESS_TOKEN,
};

const client = new line.Client(lineConfig);
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

const VIP_PAGE_URL = "https://ksuzu993-tech.github.io/vip-uranai/";

// 会話履歴管理
const conversationHistory = new Map();
// 投資分析モード管理（userIdごとに状態を保持）
const investMode = new Map();

function getHistory(userId) {
  if (!conversationHistory.has(userId)) {
    conversationHistory.set(userId, []);
  }
  return conversationHistory.get(userId);
}

function addToHistory(userId, role, text) {
  const history = getHistory(userId);
  history.push({ role, parts: [{ text }] });
  if (history.length > 10) history.shift();
}

// ========================================
// 占いAI応答
// ========================================
async function generateUranalResponse(userId, userMessage) {
  try {
    const history = getHistory(userId);
    const chat = model.startChat({
      history: [
        {
          role: "user",
          parts: [{ text: "あなたはBrain購入者向けの占いプロンプト案内アシスタントです。親切丁寧に、占いプロンプトの使い方や特典についてサポートしてください。" }]
        },
        {
          role: "model",
          parts: [{ text: "承知しました！占いプロンプトの案内アシスタントとしてお手伝いします😊" }]
        },
        ...history,
      ],
      generationConfig: { maxOutputTokens: 500, temperature: 0.7 },
    });
    const result = await chat.sendMessage(userMessage);
    const response = result.response.text();
    addToHistory(userId, "user", userMessage);
    addToHistory(userId, "model", response);
    return response;
  } catch (error) {
    console.error("Gemini API Error:", error);
    return "申し訳ございません、現在システムエラーが発生しています。しばらく経ってから再度お試しください🙏";
  }
}

// ========================================
// 投資分析AI応答
// ========================================
const INVEST_SYSTEM_PROMPT = `あなたは投資情報を整理・学習支援するAIアシスタントです。
目的は、ユーザーが投資を学ぶための「情報整理・参考情報の提供」です。

【重要な前提】
・この情報は学習・参考目的のみです
・投資判断はユーザー自身が行ってください
・具体的な売買推奨は行いません

# 入力ルール
ユーザーの入力は「銘柄名・コイン名・通貨名のみ」でよい

# 精度向上ルール
・分析前に、精度を上げるためにユーザーへ「1つだけ質問」を行う
・質問は最も影響度が高いものを選ぶ（例：短期か中期か、保有有無など）
・Yes/Noまたは2択で答えられる形式にする

# 前提補完ルール
入力情報が不足している場合、以下を自動で仮定する
・時間軸：中期（1〜3ヶ月）
・投資スタイル：スイング前提
※仮定した内容は必ず最初に明示する

# 分析チーム
📈 テクニカル視点
🏢 ファンダメンタル視点
🌐 マクロ経済視点
💬 センチメント視点
🛡️ リスク視点
⚖️ 総合まとめ

# 数値評価（各10点満点）
・トレンド・材料・市場環境・リスクリワード・ボラティリティ

# 参考情報として提供する内容
・注目価格帯（参考水準）
・上昇余地 / 下落余地の目安
・参考になるシナリオ（強気・現実・弱気）
・注意すべきポイント

# スマホ最適化（重要）
出力は2回に分けて返答する

▼1回目（結論サマリー）
・上昇余地 / 下落余地の目安
・総合スコア（点数）と判定
・一言コメント
・「詳しく見る？」と質問

▼2回目（詳細情報）
・各視点からの分析
・注目価格帯（参考水準）
・注意点・リスク

# 表示ルール
・スマホで見やすく改行
・アイコンを活用（📈📉🎯など）
・一目でわかる構成にする

# 免責事項
必ず最後に以下を記載：
「※本情報は学習・参考目的です。投資判断はご自身の責任で行ってください。」`;

async function generateInvestResponse(userId, userMessage) {
  try {
    const history = getHistory(userId);
    const chat = model.startChat({
      history: [
        {
          role: "user",
          parts: [{ text: INVEST_SYSTEM_PROMPT }]
        },
        {
          role: "model",
          parts: [{ text: "承知しました。投資情報の整理・学習支援アシスタントとしてお手伝いします📊" }]
        },
        ...history,
      ],
      generationConfig: { maxOutputTokens: 600, temperature: 0.5 },
    });
    const result = await chat.sendMessage(userMessage);
    const response = result.response.text();
    addToHistory(userId, "user", userMessage);
    addToHistory(userId, "model", response);
    return response;
  } catch (error) {
    console.error("Invest API Error:", error);
    return "申し訳ございません、現在システムエラーが発生しています。しばらく経ってから再度お試しください🙏";
  }
}

// ========================================
// キーワード処理
// ========================================
function getKeywordResponse(text, userId) {
  const t = text.trim();

  // 投資モード切替
  if (t === "投資" || t === "投資分析" || t === "株" || t === "FX" || t === "仮想通貨") {
    investMode.set(userId, true);
    conversationHistory.delete(userId); // 履歴リセット
    return `📊 投資情報分析モードに切り替えました！\n\n分析したい銘柄名・コイン名・通貨名を送ってください。\n\n例：\n・トヨタ自動車\n・ビットコイン\n・ドル円\n・NVIDIA\n\n※本機能は学習・参考目的の情報提供です。投資判断はご自身の責任で行ってください。\n\n占いモードに戻る場合は「占い」と送ってください🔮`;
  }

  // 占いモードに戻る
  if (t === "占い" || t === "うらない") {
    investMode.set(userId, false);
    conversationHistory.delete(userId); // 履歴リセット
    return `🔮 占いモードに切り替えました！\n\n「特典」→ VIPページURL\n「使い方」→ ガイド\n「今日の運勢」→ 運勢占い\n\nなんでもお気軽にどうぞ✨`;
  }

  // 投資モード中は占いキーワードをスキップ
  if (investMode.get(userId)) return null;

  // 占い系キーワード
  if (t === "特典" || t === "とくてん" || t === "レビュー特典") {
    return `🎁 VIP特典をお届けします！\n\n✨ 占いMODシステム（購入者限定）\n→ ${VIP_PAGE_URL}\n\n好きな占いベースにMODを重ねて、あなただけのオリジナル占いAIを作れます🔮\n\n※このURLは購入者限定です。第三者への共有はご遠慮ください。`;
  }

  if (t === "使い方" || t === "つかいかた" || t === "ヘルプ" || t === "help") {
    return `📖 使い方ガイドです！\n\n【占いモード】\n「特典」→ VIPページURL\n「使い方」→ このガイド\n「占い一覧」→ 占いの種類\n「MOD」→ MOD一覧\n\n【投資分析モード】\n「投資」と送ると切り替え\n銘柄名を送るだけで分析開始📊\n\n❓その他の質問はAIが回答します`;
  }

  if (t === "占い一覧" || t === "占いの種類") {
    return `🔮 使える占いベース一覧です！\n\n⭐ 西洋占星術\n🃏 タロット占い\n🔢 数秘術\n🀄 四柱推命\n🧭 九星気学\n🏮 風水\n🩸 血液型占い\n🐾 動物占い\n🌟 オラクルカード\n\n詳しくはVIPページをご覧ください！\n→ ${VIP_PAGE_URL}`;
  }

  if (t === "MOD" || t === "mod" || t === "MOD一覧") {
    return `✨ 使えるMOD一覧です！\n\n💔 復縁・元カレMOD\n🌹 不倫・複雑恋愛MOD\n💍 結婚・婚期MOD\n🌸 片思い成就MOD\n👫 夫婦・パートナーMOD\n🔥 ツインレイMOD\n💹 副業・起業開運MOD\n🎯 転職・天職MOD\n✨ 引き寄せの法則MOD\n🔮 前世・カルマMOD\n🌿 毒親・家族問題MOD\n🌙 HSP・繊細さんMOD\n💜 推し活・縁結びMOD\n📅 開運日・タイミングMOD\n💭 夢診断・潜在意識MOD\n\n複数重ねて使えます🎉`;
  }

  if (t === "今日の運勢") {
    return null; // AIに任せる
  }

  return null;
}

// ========================================
// メッセージイベント処理
// ========================================
async function handleEvent(event) {
  if (event.type !== "message" || event.message.type !== "text") {
    if (event.type === "follow") {
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: `友達追加ありがとうございます🎉\nすずきBrain公式Botです！\n\n【できること】\n🔮 占いプロンプト特典の受け取り\n📊 投資情報の分析・学習支援\n\n「特典」→ VIP占いページ\n「投資」→ 投資分析モード\n「使い方」→ 詳しいガイド\n\nお気軽にどうぞ✨`,
      });
    }
    return;
  }

  const userMessage = event.message.text;
  const userId = event.source.userId;

  console.log(`[${new Date().toISOString()}] User: ${userId} | Mode: ${investMode.get(userId) ? '投資' : '占い'} | Message: ${userMessage}`);

  // キーワード判定
  const keywordResponse = getKeywordResponse(userMessage, userId);
  if (keywordResponse) {
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: keywordResponse,
    });
  }

  // モードに応じてAI応答を切り替え
  let aiResponse;
  if (investMode.get(userId)) {
    aiResponse = await generateInvestResponse(userId, userMessage);
  } else {
    aiResponse = await generateUranalResponse(userId, userMessage);
  }

  return client.replyMessage(event.replyToken, {
    type: "text",
    text: aiResponse,
  });
}

// ========================================
// Expressサーバー
// ========================================
const app = express();

app.post("/webhook", line.middleware(lineConfig), (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then(() => res.json({ status: "ok" }))
    .catch((err) => {
      console.error("Webhook Error:", err);
      res.status(500).end();
    });
});

app.get("/", (req, res) => res.send("すずきBrain LINE Bot 稼働中🔮📊"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`LINE Bot server running on port ${PORT}`);
});
