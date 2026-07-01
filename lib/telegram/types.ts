export type TelegramUpdate = {
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
  callback_query?: {
    id: string
    data?: string
    from?: {
      id?: number
      username?: string
      first_name?: string
      last_name?: string
    }
    message?: {
      chat?: {
        id?: number
      }
    }
  }
}
