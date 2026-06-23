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
    caption?: string
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

type ReminderExtraction =
  | {
      action: 'create_reminder'
      reminder_text: string
      event_time: string | null
      remind_at: string
      timezone: string
      confirmation_message: string
    }
  | {
      action: 'ask_clarifying_question'
      clarifying_question: string
    }
  | {
      action: 'not_reminder'
    }

type SaveReminderParams = {
  supabase: ReturnType<typeof getSupabase>
  userId: string
  chatId: number
  reminderText: string
  eventTime: string | null
  remindAt: string
  timezone: string
  sourceMessageContent: string
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

function isLikelyReminderRequest(text: string): boolean {
  const lower = text.toLowerCase()
  return (
    lower.includes('remind me') ||
    lower.includes('reminder') ||
    lower.includes('提醒我') ||
    lower.includes('提醒') ||
    lower.includes('叫我') ||
    lower.includes('let me know') ||
    lower.includes('tell me before')
  )
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

function hasExplicitTimezoneOffset(value: string): boolean {
  return /(?:Z|[+-]\d{2}:\d{2})$/i.test(value)
}

function parseReminderExtraction(raw: string): ReminderExtraction {
  const cleaned = raw
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim()

  try {
    return JSON.parse(cleaned) as ReminderExtraction
  } catch {
    const firstBrace = cleaned.indexOf('{')
    const lastBrace = cleaned.lastIndexOf('}')

    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1)) as ReminderExtraction
    }

    throw new Error(`Failed to parse reminder extraction JSON: ${raw}`)
  }
}

async function extractReminderFromText(text: string): Promise<ReminderExtraction> {
  const now = new Date()
  const nowIso = now.toISOString()
  const singaporeNow = new Intl.DateTimeFormat('en-SG', {
    timeZone: 'Asia/Singapore',
    dateStyle: 'full',
    timeStyle: 'long',
  }).format(now)
  const parserPrompt = `You are extracting reminder information for Bergi.

Current UTC time: ${nowIso}
Current Asia/Singapore time: ${singaporeNow}
Default timezone: Asia/Singapore

Return ONLY valid JSON.

If the user clearly asks to be reminded and enough information is available, return:
{
  "action": "create_reminder",
  "reminder_text": "...",
  "event_time": "ISO timestamp or null",
  "remind_at": "ISO timestamp",
  "timezone": "Asia/Singapore",
  "confirmation_message": "..."
}

If the user asks for a reminder but the reminder time is unclear, return:
{
  "action": "ask_clarifying_question",
  "clarifying_question": "..."
}

If this is not a reminder request, return:
{
  "action": "not_reminder"
}

Rules:
- Default timezone is Asia/Singapore.
- If the user does not mention a timezone or location, assume Asia/Singapore.
- Resolve relative dates like "today", "tomorrow", "tonight", and "next week" based on the timezone being used, not UTC.
- In confirmation_message, always mention the timezone used, for example "Singapore time".
- If the user explicitly mentions a timezone or location, use the best matching timezone:
  - Singapore / SG → Asia/Singapore
  - China / Hangzhou / Shanghai / Beijing → Asia/Shanghai
  - Malaysia / KL → Asia/Kuala_Lumpur
  - Japan / Tokyo → Asia/Tokyo
  - Korea / Seoul → Asia/Seoul
  - Germany / Berlin → Europe/Berlin
  - UK / London → Europe/London
- If the user says something ambiguous like "local time", "when I'm overseas", or implies travel without a clear location/timezone, return:
{
  "action": "ask_clarifying_question",
  "clarifying_question": "Which timezone should I use for this reminder — Singapore time or your local time?"
}
- For create_reminder, set the timezone field to the IANA timezone actually used.
- remind_at and event_time should be valid ISO timestamps representing the correct instant for that timezone.
- remind_at and event_time must include an explicit timezone offset or Z.
- Good examples: 2026-06-24T18:30:00+08:00, 2026-06-24T10:30:00.000Z.
- Bad example: 2026-06-24T18:30:00.
- If the user says "meeting tomorrow at 7pm, remind me half an hour before", event_time should be tomorrow 7pm in the chosen timezone and remind_at should be 30 minutes before.
- If the user says "remind me at 6:30pm tomorrow to prep for SMUX meeting", event_time can be null and remind_at should be tomorrow 6:30pm in the chosen timezone.
- confirmation_message should clearly confirm the active reminder, mention the reminder time and timezone used, and stay concise.
- Example confirmation_message: "Got it — I’ll remind you tomorrow at 6:30pm Singapore time."`

  const response = await callLLM({
    systemPrompt: parserPrompt,
    chatMessages: [{ role: 'user', content: text }],
  })

  return parseReminderExtraction(response)
}

async function saveReminder(params: SaveReminderParams): Promise<void> {
  const { supabase, userId, chatId, reminderText, eventTime, remindAt, sourceMessageContent } = params
  const timezone = params.timezone || 'Asia/Singapore'

  if (!reminderText.trim()) {
    throw new Error('Reminder text is required')
  }

  if (Number.isNaN(Date.parse(remindAt))) {
    throw new Error('Reminder remind_at is invalid')
  }

  if (!hasExplicitTimezoneOffset(remindAt)) {
    throw new Error('Reminder remind_at must include timezone offset or Z')
  }

  if (eventTime !== null && Number.isNaN(Date.parse(eventTime))) {
    throw new Error('Reminder event_time is invalid')
  }

  if (eventTime !== null && !hasExplicitTimezoneOffset(eventTime)) {
    throw new Error('Reminder event_time must include timezone offset or Z')
  }

  const { error } = await supabase.from('reminders').insert({
    user_id: userId,
    platform: 'telegram',
    telegram_chat_id: chatId,
    reminder_text: reminderText,
    event_time: eventTime,
    remind_at: remindAt,
    timezone,
    status: 'pending',
    source_message_content: sourceMessageContent,
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

async function describeImage(imageBuffer: ArrayBuffer, mimeType = 'image/jpeg', caption?: string): Promise<string> {
  const baseUrl = process.env.OPENAI_BASE_URL
  const apiKey = process.env.OPENAI_API_KEY
  const model = process.env.OPENAI_MODEL

  if (!baseUrl || !apiKey || !model) {
    throw new Error('Missing OpenAI environment variables')
  }

  const base64Image = Buffer.from(imageBuffer).toString('base64')
  const imageDataUrl = `data:${mimeType};base64,${base64Image}`
  const prompt = caption
    ? `The user sent a Telegram photo with this caption/question:
${caption}

Analyze the image specifically to help answer the caption/question. Focus only on what is visible in the image. If the caption asks for a count, estimate the count from the visible image. If unsure, say that it is approximate. Do not write as Bergi. Do not make jokes. Do not suggest a reply. Return only a short neutral image analysis that can be used as context for a later chat reply.`
    : 'Describe this image briefly in 1–2 sentences. Focus only on what is visibly in the image. Do not suggest a reply. Do not write as Bergi. Do not include headings, bullet points, or labels. Just return a short neutral description that can be used as context for a later chat reply.'

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
              text: prompt,
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

function formatForTelegramPlainText(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*(-{3,}|\*{3,}|_{3,})\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
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
    const caption = update.message?.caption
    const voice = update.message?.voice
    const photo = update.message?.photo
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

    const selectedPhoto = chooseTelegramPhotoSize(photo)

    if (userText === undefined && voice === undefined && selectedPhoto === null) {
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
    } else if (selectedPhoto !== null) {
      const filePath = await getTelegramFilePath(selectedPhoto.file_id)
      const imageBuffer = await downloadTelegramFile(filePath)
      const imageDescription = await describeImage(imageBuffer, 'image/jpeg', caption)

      if (caption) {
        userMessageToSave = `[photo] ${imageDescription}\n[caption] ${caption}`
        userMessageForLLM = `The user sent a Telegram photo with a caption/question. Use the image analysis below to answer the user's caption/question directly first. After answering, you may add Bergi personality lightly, but do not ignore the question.

Image description:
${imageDescription}

User caption:
${caption}

Reply naturally as Bergi using the recent conversation context.`
      } else {
        userMessageToSave = `[photo] ${imageDescription}`
        userMessageForLLM = `The user sent a Telegram photo. The image was analyzed automatically.

Image description:
${imageDescription}

Reply naturally as Bergi using the recent conversation context.`
      }
    } else {
      if (userText === undefined) {
        throw new Error('Expected text message but userText was undefined')
      }

      userMessageToSave = userText
      userMessageForLLM = userText
    }

    await saveMessage({ supabase, userId, role: 'user', content: userMessageToSave })

    if (userText !== undefined && voice === undefined && selectedPhoto === null && isLikelyReminderRequest(userText)) {
      const reminderExtraction = await extractReminderFromText(userText)

      if (reminderExtraction.action === 'create_reminder') {
        await saveReminder({
          supabase,
          userId,
          chatId,
          reminderText: reminderExtraction.reminder_text,
          eventTime: reminderExtraction.event_time,
          remindAt: reminderExtraction.remind_at,
          timezone: reminderExtraction.timezone || 'Asia/Singapore',
          sourceMessageContent: userText,
        })

        const reminderConfirmation = formatForTelegramPlainText(reminderExtraction.confirmation_message)

        if (isLocalTestMode) {
          console.log('Local test reminder confirmation:', reminderConfirmation)
        } else {
          await sendTelegramMessage(chatId, reminderConfirmation)
        }

        await saveMessage({ supabase, userId, role: 'assistant', content: reminderConfirmation })
        return new Response('OK', { status: 200 })
      }

      if (reminderExtraction.action === 'ask_clarifying_question') {
        const clarifyingQuestion = formatForTelegramPlainText(reminderExtraction.clarifying_question)

        if (isLocalTestMode) {
          console.log('Local test reminder clarifying question:', clarifyingQuestion)
        } else {
          await sendTelegramMessage(chatId, clarifyingQuestion)
        }

        await saveMessage({ supabase, userId, role: 'assistant', content: clarifyingQuestion })
        return new Response('OK', { status: 200 })
      }
    }

    const profile = await getUserProfile({ supabase, userId })
    const systemPrompt =
      profile?.personalityPrompt ??
      'You are Bergi, a private AI friend on Telegram. Reply casually, warmly, and concisely. Use recent chat history for context, but do not over-explain.'
    const responseModeGuidance = `
Response mode guidance:
Before replying, privately decide what kind of response Min needs. Do not mention the mode label.

Use casual chat mode when Min is just chatting, sharing something lightly, or asking for a normal friendly reply.

Use organise mode when Min explicitly says things like:
- organise this
- summarize this
- make this clearer
- help me plan this
- what should I do next
- turn this into steps
- structure this
- clean this up

Also use organise mode when Min sends a long, messy, brain-dump style message or voice transcript that clearly needs structure, even if he does not explicitly say "organise".

In organise mode:
- be clear and useful first
- use compact plain-text structure
- use short plain-text section labels like "Do this now:" or "Next steps:"
- use numbered lists for priority/order
- use simple bullets with "-"
- remove repeated/filler ideas
- preserve Min's intended meaning
- do not invent missing details
- ask a brief clarifying question if the message is too unclear
- keep the output compact unless Min asks for detail

Telegram formatting rule:
Telegram messages are currently sent as plain text. Do not use Markdown or HTML formatting.
Never use:
- **bold**
- *italic*
- ### headings
- markdown tables
- horizontal rules
- backticks for emphasis

Bad:
**Do this now:**
**1. Boss meeting prep**

Good:
Do this now:

1. Boss meeting prep
- What you finished
- What is pending

Style rule:
Always answer Min's actual request first. Use humour, Singlish, and playful friend energy lightly, but not in every reply. Avoid turning every response into a comedy bit.
`
    const finalSystemPrompt = `${systemPrompt}

${responseModeGuidance}`
    const recentMessages = await getRecentMessages({ supabase, userId })
    const recentMessagesForLLM = [...recentMessages]

    if (voice !== undefined || selectedPhoto !== null) {
      for (let index = recentMessagesForLLM.length - 1; index >= 0; index -= 1) {
        const message = recentMessagesForLLM[index]

        if (message.role === 'user') {
          recentMessagesForLLM[index] = { ...message, content: userMessageForLLM }
          break
        }
      }
    } else if (userText !== undefined) {
      let latestUserMessageIndex = -1

      for (let index = recentMessagesForLLM.length - 1; index >= 0; index -= 1) {
        if (recentMessagesForLLM[index].role === 'user') {
          latestUserMessageIndex = index
          break
        }
      }

      const latestPhotoContext = recentMessagesForLLM
        .slice(0, latestUserMessageIndex)
        .reverse()
        .find((message) => message.role === 'user' && message.content.startsWith('[photo]'))?.content

      if (latestUserMessageIndex !== -1 && latestPhotoContext) {
        recentMessagesForLLM[latestUserMessageIndex] = {
          ...recentMessagesForLLM[latestUserMessageIndex],
          content: `The user sent this text message after a recent photo.

Recent photo context:
${latestPhotoContext}

Current text message:
${userText}

Reply naturally as Bergi. If the current text seems related to the photo, use the photo context. If it does not seem related, prioritize the text message.`,
        }
      }
    }

    const trimmedMessages = trimMessagesByCharacterLimit(recentMessagesForLLM, 4000)
    const llmResponse = await callLLM({ chatMessages: trimmedMessages, systemPrompt: finalSystemPrompt })
    const telegramReply = formatForTelegramPlainText(llmResponse)

    if (isLocalTestMode) {
      console.log('Local test LLM response:', telegramReply)
      await saveMessage({ supabase, userId, role: 'assistant', content: telegramReply })
    } else {
      await sendTelegramMessage(chatId, telegramReply)
      await saveMessage({ supabase, userId, role: 'assistant', content: telegramReply })
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
