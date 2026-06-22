type TelegramUpdate = {
  message?: {
    chat?: {
      id?: number
    }
    text?: string
  }
}

async function callLLM(userText: string): Promise<string> {
  const baseUrl = process.env.OPENAI_BASE_URL
  const apiKey = process.env.OPENAI_API_KEY
  const model = process.env.OPENAI_MODEL

  if (!baseUrl || !apiKey || !model) {
    throw new Error('Missing OpenAI environment variables')
  }

  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 300,
      messages: [
        {
          role: 'system',
          content: "You are Bergi, Min's friendly AI companion. Reply casually, warmly, and concisely.",
        },
        { role: 'user', content: userText },
      ],
    }),
  })

  if (!response.ok) {
    throw new Error(`OpenAI API request failed: ${response.status}`)
  }

  const data = await response.json()
  return data.choices?.[0]?.message?.content ?? 'Sorry, I could not generate a response.'
}

async function sendTelegramMessage(chatId: number, text: string): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN

  if (!botToken) {
    throw new Error('Missing Telegram bot token')
  }

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      chat_id: chatId,
      text,
    }),
  })

  if (!response.ok) {
    throw new Error(`Telegram sendMessage request failed: ${response.status}`)
  }
}

export async function POST(request: Request) {
  try {
    const update = (await request.json()) as TelegramUpdate
    const chatId = update.message?.chat?.id
    const userText = update.message?.text

    console.log('Telegram webhook message:', update.message)

    if (chatId === undefined || !userText) {
      return new Response('OK', { status: 200 })
    }

    const llmResponse = await callLLM(userText)
    await sendTelegramMessage(chatId, llmResponse)
  } catch (error) {
    console.error('Telegram webhook error:', error)
  }

  return new Response('OK', { status: 200 })
}
