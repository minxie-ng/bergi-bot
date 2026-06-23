import { createClient } from '@supabase/supabase-js'

type TelegramUpdate = {
  message?: {
    from?: {
      id?: number
      username?: string
      first_name?: string
      last_name?: string
    }
    chat?: {
      id?: number
    }
    text?: string
    sticker?: unknown
    animation?: unknown
    voice?: {
      file_id: string
      duration?: number
      mime_type?: string
      file_size?: number
    }
    photo?: Array<{
      file_id: string
      file_unique_id?: string
      width?: number
      height?: number
      file_size?: number
    }>
  }
}

type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
}

type FindOrCreateUserAccountParams = {
  supabase: ReturnType<typeof getSupabase>
  platformUserId: string
  username?: string
  firstName?: string
  lastName?: string
}

type SaveMessageParams = {
  supabase: ReturnType<typeof getSupabase>
  userId: string
  role: 'user' | 'assistant'
  content: string
}

type UserProfile = {
  displayName: string | null
  preferredLanguage: string | null
  personalityPrompt: string
}

function getSupabase() {
  const supabaseUrl = process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing Supabase environment variables')
  }

  return createClient(supabaseUrl, serviceRoleKey)
}

function isAllowedTelegramUser(telegramUserId: number): boolean {
  const allowedTelegramUserIds = process.env.ALLOWED_TELEGRAM_USER_IDS

  if (!allowedTelegramUserIds) {
    return false
  }

  return allowedTelegramUserIds
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
    .includes(String(telegramUserId))
}

function chooseTelegramPhotoSize(
  photoSizes: NonNullable<TelegramUpdate['message']>['photo']
): { file_id: string; width?: number; height?: number; file_size?: number } | null {
  if (!photoSizes || photoSizes.length === 0) {
    return null
  }

  return photoSizes[photoSizes.length - 1]
}

async function findOrCreateUserAccount(params: FindOrCreateUserAccountParams): Promise<string> {
  const { supabase, platformUserId, username, firstName, lastName } = params

  const { data: existingAccount, error: existingAccountError } = await supabase
    .from('user_accounts')
    .select('user_id')
    .eq('platform', 'telegram')
    .eq('platform_user_id', platformUserId)
    .maybeSingle()

  if (existingAccountError) {
    throw existingAccountError
  }

  if (existingAccount?.user_id) {
    return existingAccount.user_id
  }

  const { data: user, error: userError } = await supabase.from('users').insert({}).select('id').single()

  if (userError) {
    throw userError
  }

  const { error: userAccountError } = await supabase.from('user_accounts').insert({
    user_id: user.id,
    platform: 'telegram',
    platform_user_id: platformUserId,
    username: username ?? null,
    first_name: firstName ?? null,
    last_name: lastName ?? null,
  })

  if (userAccountError) {
    throw userAccountError
  }

  return user.id
}

async function saveMessage(params: SaveMessageParams): Promise<void> {
  const { supabase, userId, role, content } = params

  const { error } = await supabase.from('messages').insert({
    user_id: userId,
    platform: 'telegram',
    role,
    content,
  })

  if (error) {
    throw error
  }
}

async function getUserProfile(params: {
  supabase: ReturnType<typeof getSupabase>
  userId: string
}): Promise<UserProfile | null> {
  const { supabase, userId } = params

  const { data, error } = await supabase
    .from('user_profiles')
    .select('display_name, preferred_language, personality_prompt')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    throw error
  }

  if (!data) {
    return null
  }

  return {
    displayName: data.display_name,
    preferredLanguage: data.preferred_language,
    personalityPrompt: data.personality_prompt,
  }
}

async function getRecentMessages(params: {
  supabase: ReturnType<typeof getSupabase>
  userId: string
}): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
  const { supabase, userId } = params

  const { data, error } = await supabase
    .from('messages')
    .select('role, content')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) {
    throw error
  }

  return (data ?? [])
    .reverse()
    .map((message) => ({ role: message.role as 'user' | 'assistant', content: message.content as string }))
}

function trimMessagesByCharacterLimit(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  maxCharacters: number
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const selectedMessages: Array<{ role: 'user' | 'assistant'; content: string }> = []
  let totalCharacters = 0

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    const messageLength = message.content.length

    if (totalCharacters + messageLength > maxCharacters) {
      if (selectedMessages.length === 0) {
        selectedMessages.push({
          ...message,
          content: message.content.slice(0, maxCharacters),
        })
      }

      continue
    }

    selectedMessages.push(message)
    totalCharacters += messageLength
  }

  return selectedMessages.reverse()
}

async function callLLM(params: { chatMessages: ChatMessage[]; systemPrompt: string }): Promise<string> {
  const { chatMessages, systemPrompt } = params
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
          content: systemPrompt,
        },
        ...chatMessages,
      ],
    }),
  })

  if (!response.ok) {
    throw new Error(`OpenAI API request failed: ${response.status}`)
  }

  const data = await response.json()
  return data.choices?.[0]?.message?.content ?? 'Sorry, I could not generate a response.'
}

async function describeImage(imageBuffer: ArrayBuffer, mimeType = 'image/jpeg'): Promise<string> {
  const baseUrl = process.env.OPENAI_BASE_URL
  const apiKey = process.env.OPENAI_API_KEY
  const model = process.env.OPENAI_MODEL

  if (!baseUrl || !apiKey || !model) {
    throw new Error('Missing OpenAI environment variables')
  }

  const base64Image = Buffer.from(imageBuffer).toString('base64')
  const imageDataUrl = `data:${mimeType};base64,${base64Image}`

  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Describe this image briefly and focus on details that would help Bergi reply naturally in a Telegram chat.',
            },
            {
              type: 'image_url',
              image_url: {
                url: imageDataUrl,
              },
            },
          ],
        },
      ],
    }),
  })

  if (!response.ok) {
    throw new Error(`Image description request failed: ${response.status}`)
  }

  const data = await response.json()
  const content = data.choices?.[0]?.message?.content

  if (typeof content !== 'string') {
    throw new Error('Image description response did not include content')
  }

  return content
}

async function getTelegramFilePath(fileId: string): Promise<string> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN

  if (!botToken) {
    throw new Error('Missing Telegram bot token')
  }

  const response = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(fileId)}`)

  if (!response.ok) {
    throw new Error(`Telegram getFile request failed: ${response.status}`)
  }

  const data = await response.json()
  const filePath = data.result?.file_path

  if (!data.ok || typeof filePath !== 'string') {
    throw new Error('Telegram getFile response did not include a file path')
  }

  return filePath
}

async function downloadTelegramFile(filePath: string): Promise<ArrayBuffer> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN

  if (!botToken) {
    throw new Error('Missing Telegram bot token')
  }

  const response = await fetch(`https://api.telegram.org/file/bot${botToken}/${filePath}`)

  if (!response.ok) {
    throw new Error(`Telegram file download failed: ${response.status}`)
  }

  return response.arrayBuffer()
}

async function transcribeAudio(audioBuffer: ArrayBuffer, filename = 'voice.ogg'): Promise<string> {
  const baseUrl = process.env.TRANSCRIPTION_BASE_URL
  const apiKey = process.env.TRANSCRIPTION_API_KEY
  const model = process.env.TRANSCRIPTION_MODEL || 'whisper-1'

  if (!baseUrl || !apiKey) {
    throw new Error('Missing transcription environment variables')
  }

  const formData = new FormData()
  const audioBlob = new Blob([audioBuffer], { type: 'audio/ogg' })

  formData.append('model', model)
  formData.append('file', audioBlob, filename)

  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/audio/transcriptions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  })

  if (!response.ok) {
    throw new Error(`Audio transcription request failed: ${response.status}`)
  }

  const data = await response.json()

  if (typeof data.text !== 'string') {
    throw new Error('Audio transcription response did not include text')
  }

  return data.text
}

function formatVoiceTranscriptForLLM(transcript: string): string {
  return `The user's message below was transcribed from a Telegram voice message.
It may contain filler words, repeated phrases, incomplete sentences, mixed language, or transcription errors.
Infer the user's intent carefully using the recent conversation context, but do not invent missing details.
If the transcript is unclear, ask a brief clarifying question instead of pretending to understand.

Transcript:
${transcript}`
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
  let chatId: number | undefined

  try {
    const update = (await request.json()) as TelegramUpdate
    chatId = update.message?.chat?.id
    const userText = update.message?.text
    const voice = update.message?.voice
    const from = update.message?.from
    const isLocalTestMode = process.env.LOCAL_TEST_MODE === 'true'

    console.log('Telegram webhook message:', update.message)

    if (chatId === undefined || from?.id === undefined) {
      return new Response('OK', { status: 200 })
    }

    if (!isAllowedTelegramUser(from.id)) {
      console.log('Blocked unauthorized Telegram user:', from.id)

      if (isLocalTestMode) {
        console.log('Local test unauthorized response:', 'Sorry, Bergi is currently private.')
      } else {
        await sendTelegramMessage(chatId, 'Sorry, Bergi is currently private.')
      }

      return new Response('OK', { status: 200 })
    }

    if (userText === undefined && voice === undefined) {
      let nonTextReply = "eh I received something, but I don't know how to process it yet 😵‍💫"
      let nonTextContent = '[unknown] user sent an unsupported message type'

      if (update.message?.sticker) {
        nonTextReply = 'wah sticker only ah, I cannot read your mind yet 😭'
        nonTextContent = '[sticker] user sent a sticker'
      } else if (update.message?.animation) {
        nonTextReply = 'gif received but I not smart enough to understand it yet sia'
        nonTextContent = '[gif] user sent a GIF'
      }

      const supabase = getSupabase()
      const userId = await findOrCreateUserAccount({
        supabase,
        platformUserId: String(from.id),
        username: from.username,
        firstName: from.first_name,
        lastName: from.last_name,
      })

      await saveMessage({ supabase, userId, role: 'user', content: nonTextContent })

      if (isLocalTestMode) {
        console.log('Local test non-text response:', nonTextReply)
      } else {
        await sendTelegramMessage(chatId, nonTextReply)
      }

      try {
        await saveMessage({ supabase, userId, role: 'assistant', content: nonTextReply })
      } catch (saveAssistantError) {
        console.error('Failed to save non-text assistant reply:', saveAssistantError)
      }

      return new Response('OK', { status: 200 })
    }

    const supabase = getSupabase()
    const userId = await findOrCreateUserAccount({
      supabase,
      platformUserId: String(from.id),
      username: from.username,
      firstName: from.first_name,
      lastName: from.last_name,
    })

    let userMessageToSave: string
    let userMessageForLLM: string

    if (voice !== undefined) {
      if (voice.duration !== undefined && voice.duration > 40) {
        const voiceTooLongReply = 'wah minxie this voice note too long sia 😭 keep it under 40 seconds first'

        await saveMessage({
          supabase,
          userId,
          role: 'user',
          content: '[voice too long] user sent a voice message longer than 40 seconds',
        })

        if (isLocalTestMode) {
          console.log('Local test voice too long response:', voiceTooLongReply)
        } else {
          await sendTelegramMessage(chatId, voiceTooLongReply)
        }

        try {
          await saveMessage({ supabase, userId, role: 'assistant', content: voiceTooLongReply })
        } catch (saveAssistantError) {
          console.error('Failed to save voice-too-long assistant reply:', saveAssistantError)
        }

        return new Response('OK', { status: 200 })
      }

      const filePath = await getTelegramFilePath(voice.file_id)
      const audioBuffer = await downloadTelegramFile(filePath)
      const transcript = await transcribeAudio(audioBuffer)

      userMessageToSave = `[voice transcript] ${transcript}`
      userMessageForLLM = formatVoiceTranscriptForLLM(transcript)
    } else {
      if (userText === undefined) {
        throw new Error('Expected text message but userText was undefined')
      }

      userMessageToSave = userText
      userMessageForLLM = userText
    }

    await saveMessage({ supabase, userId, role: 'user', content: userMessageToSave })

    const profile = await getUserProfile({ supabase, userId })
    const systemPrompt =
      profile?.personalityPrompt ??
      'You are Bergi, a private AI friend on Telegram. Reply casually, warmly, and concisely. Use recent chat history for context, but do not over-explain.'
    const recentMessages = await getRecentMessages({ supabase, userId })
    const recentMessagesForLLM = [...recentMessages]

    if (voice !== undefined) {
      for (let index = recentMessagesForLLM.length - 1; index >= 0; index -= 1) {
        const message = recentMessagesForLLM[index]

        if (message.role === 'user') {
          recentMessagesForLLM[index] = { ...message, content: userMessageForLLM }
          break
        }
      }
    }

    const trimmedMessages = trimMessagesByCharacterLimit(recentMessagesForLLM, 4000)
    const llmResponse = await callLLM({ chatMessages: trimmedMessages, systemPrompt })

    if (isLocalTestMode) {
      console.log('Local test LLM response:', llmResponse)
      await saveMessage({ supabase, userId, role: 'assistant', content: llmResponse })
    } else {
      await sendTelegramMessage(chatId, llmResponse)
      await saveMessage({ supabase, userId, role: 'assistant', content: llmResponse })
    }
  } catch (error) {
    console.error('Telegram webhook error:', error)

    try {
      if (chatId !== undefined) {
        await sendTelegramMessage(chatId, 'eh minxie I glitch a bit just now 😵‍💫 try again later can?')
      }
    } catch (fallbackError) {
      console.error('Telegram fallback message error:', fallbackError)
    }
  }

  return new Response('OK', { status: 200 })
}

export async function GET() {
  return Response.json({
    ok: true,
    route: 'telegram webhook',
    message: 'Bergi Telegram route is alive',
  })
}
