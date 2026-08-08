/** Participante de uma conversa (vendedor ou comprador). */
export interface MessageUser {
  user_id: number
  id?: number
}

/** Destinatário do envio de mensagem. */
export interface MessageRecipient {
  user_id: number
  resource: string
  site_id?: string
  email?: string
}

/** Anexo de uma mensagem (arquivo já carregado no ML). */
export interface MessageAttachment {
  id: string
  url: string
  type?: string
  name?: string
}

/** Mensagem do chat pós-venda (tópico `messages`). */
export interface Message {
  id: number | string
  from: MessageUser
  to: MessageRecipient
  text: string
  attachments?: MessageAttachment[]
  date_created: string
  message_date?: string
  message_type?: string
  tag?: string
}

/** Payload de envio de mensagem. */
export interface MessageSendInput {
  /** Id do vendedor (quem envia). */
  from: MessageUser
  /** Destinatário e recurso (pedido) ao qual a mensagem pertence. */
  to: MessageRecipient
  text: string
}
