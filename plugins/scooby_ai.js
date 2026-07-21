const { GoogleGenAI } = require('@google/genai')
const { bot, parsedJid } = require('../lib/') // Importação correta do ecossistema Levanter

const RESPOSTAS_NEGADAS = [
  'Sai fora, Salsicha! Você não tem cargo de Admin aqui não. Só falo com os chefes do mistério! 🐕',
  'Tô ocupado comendo um Biscoito Scooby agora. Quer falar comigo? Pede autorização pros ADMs primeiro, reles mortal. 🦴',
  'Ih, o liso tá querendo gastar meus neurônios de graça? Só respondo para a elite (os Administradores). Tente novamente quando subir de nível! 🪙',
  'Você não tem poder aqui! Vá chorar no privado do Admin para ele te dar privilégios, porque comigo você não se cria. 🤫',
  'Ora ora, parece que temos um xereta querendo usar meus super poderes de IA sem ter o crachá de ADM. Volte para o furgão, Salsicha! 🚐',
  'Até a Velma sem óculos consegue enxergar que você não é Administrator desse grupo. Sem cargo, sem respostas! 👓',
  'Isso é um fantasma? Um monstro? Não, é só um membro comum achando que tem moral pra me dar ordens. Chame um ADM! 👻',
  'Meus circuitos de doguinho foram programados para ignorar pedidos de quem não manda em nada. Quer biscoito? Pede pros ADMs! 🍪',
  'Alerta de intruso! 🚨 Você não tem a tag de Admin configurada no seu perfil. Minhas respostas custam caro e seu saldo de poder está zerado!',
  'Nem com a Máquina do Mistério cheia de pista eu consigo encontrar o seu nome na lista de administradores. Tente outra vez quando mandar em algo! 🗺️',
]

const GEMINI_MODEL = 'gemini-2.5-flash'
const GEMINI_TIMEOUT_MS = 30000
const RATE_LIMIT_MS = 10000
const MAX_QUESTION_LENGTH = 2000
const TRAFFIC_REGEX = /tem uma em (cp|campestre)/i

const lastCallByUser = new Map()
let genAI = null

function getGenAI() {
  if (!genAI) genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  return genAI
}

// Armazenamento em arquivo JSON local robusto (Evita quebrar o Sequelize nativo do Levanter)
const fs = require('fs')
const path = require('path')
const logFilePath = path.join(__dirname, '../scooby_log.json')

function salvarLog(data) {
  let logs = []
  if (fs.existsSync(logFilePath)) {
    try { logs = JSON.parse(fs.readFileSync(logFilePath, 'utf-8')) } catch (e) { logs = [] }
  }
  logs.push(data)
  fs.writeFileSync(logFilePath, JSON.stringify(logs, null, 2))
}

function obterLogs() {
  if (!fs.existsSync(logFilePath)) return []
  try { return JSON.parse(fs.readFileSync(logFilePath, 'utf-8')) } catch (e) { return [] }
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ])
}

// Handler Principal: Ativação por Prefixo e Comando Scooby
bot({ pattern: 'scooby ?(.*)', fromMe: false, desc: 'Chama a IA do Scooby (Apenas Admins)' }, async (message, match) => {
  try {
    if (!message.isGroup) return // Ignora em DMs
    
    const groupJid = message.jid
    const senderJid = message.participant
    
    // Checagem nativa de admin do Levanter
    const groupMetadata = await message.client.groupMetadata(groupJid)
    const participants = groupMetadata.participants
    const isSenderAdmin = participants.find(p => p.id === senderJid)?.admin
    
    if (!isSenderAdmin) {
      const frase = RESPOSTAS_NEGADAS[Math.floor(Math.random() * RESPOSTAS_NEGADAS.length)]
      return await message.send(frase, { quoted: message.data })
    }

    const pergunta = match[1]?.trim()
    if (!pergunta) {
      return await message.send('E aí, qual é a pergunta? Não vou adivinhar, eu sou cachorro, não vidente. 🐾')
    }

    if (!process.env.GEMINI_API_KEY) {
      return await message.send('Minha coleira de IA não tá configurada (falta GEMINI_API_KEY). 🦴')
    }

    const now = Date.now()
    const last = lastCallByUser.get(senderJid) || 0
    if (now - last < RATE_LIMIT_MS) {
      return await message.send('Calma aí, cão elétrico também precisa recarregar. Espera uns segundos e manda de novo. ⚡')
    }
    lastCallByUser.set(senderJid, now)

    const perguntaTruncada = pergunta.slice(0, MAX_QUESTION_LENGTH)

    try {
      const ai = getGenAI()
      const response = await withTimeout(
        ai.models.generateContent({
          model: GEMINI_MODEL,
          contents: perguntaTruncada,
          config: {
            systemInstruction: 'Você é o Scooby, uma IA sarcástica, debochada, com humor ácido e irônico. Responda sempre em português do Brasil, com gírias de internet, como um doguinho cínico. Nunca dê respostas formais nem faça palestrinha. Seja breve: no máximo 4 frases.',
            safetySettings: [
              { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
              { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
              { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
              { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
            ],
          },
        }),
        GEMINI_TIMEOUT_MS
      )

      const resposta = response.text?.trim()
      await message.send(resposta || 'Rosnei pro Gemini e ele voltou sem resposta. Tenta de novo. 🐕', { quoted: message.data })
    } catch (err) {
      console.error('[scooby_ai] erro Gemini:', err)
      await message.send('Escorreguei numa pista falsa e a IA não respondeu. Tenta de novo. 🦴')
    }
  } catch (err) {
    console.error('[scooby_ai] erro handler:', err)
  }
})

// Handler Passivo do Levanter (Captura de tráfego)
bot({ on: 'text', fromMe: false }, async (message) => {
  try {
    if (!message.isGroup) return
    const text = message.text || message.message
    if (!text || !TRAFFIC_REGEX.test(text)) return

    salvarLog({
      text,
      groupJid: message.jid,
      senderJid: message.participant || message.sender,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    console.error('[scooby_ai] erro log passivo:', err)
  }
})

// Comando de Relatório
bot({ pattern: 'relatorio', fromMe: false, desc: 'Gera relatório de tráfego' }, async (message) => {
  try {
    const senderJid = message.participant || message.sender
    
    if (message.isGroup) {
      const groupMetadata = await message.client.groupMetadata(message.jid)
      const isSenderAdmin = groupMetadata.participants.find(p => p.id === senderJid)?.admin
      if (!isSenderAdmin) return
    } else {
      const owners = (process.env.SCOOBY_OWNERS || '').split(',').map(j => j.trim()).filter(Boolean)
      if (!owners.includes(senderJid)) return
    }

    const logs = obterLogs()
    const total = logs.length
    const recentes = logs.slice(-20).reverse()

    const linhas = recentes.map((r) => `• ${new Date(r.timestamp).toLocaleString('pt-BR')} — ${r.text}`)
    const corpo = linhas.length ? linhas.join('\n') : 'Nenhuma ocorrência registrada ainda.'

    await message.send(`📋 *Relatório Scooby*\nTotal de ocorrências: ${total}\n\nÚltimas ${recentes.length}:\n${corpo}`)
  } catch (err) {
    console.error('[scooby_ai] erro relatorio:', err)
  }
})

