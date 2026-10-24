"use strict";

// Server permissions: the catalog shown in Configurações do Servidor > Cargos
// (sent to the app with the state) and the rules the backend enforces. Only
// what the app actually does is listed.

const PERMISSION_GROUPS = [
  {
    title: "Permissões gerais do servidor",
    perms: [
      { flag: "MANAGE_CHANNELS", label: "Gerenciar canais", desc: "Criar, renomear, organizar em categorias e excluir canais." },
      { flag: "MANAGE_ROLES", label: "Gerenciar cargos", desc: "Criar, editar, dar e tirar cargos inferiores ao seu." },
      { flag: "VIEW_AUDIT_LOG", label: "Ver o registro de auditoria", desc: "Acessar o histórico administrativo do servidor." },
      { flag: "MANAGE_SERVER", label: "Gerenciar servidor", desc: "Alterar nome, ícone e banner do servidor." }
    ]
  },
  {
    title: "Permissões de membros",
    perms: [
      { flag: "CREATE_INSTANT_INVITE", label: "Criar convite", desc: "Gerar links de convite para o servidor." },
      { flag: "KICK_MEMBERS", label: "Expulsar membros", desc: "Remover membros (eles podem voltar com um convite)." },
      { flag: "BAN_MEMBERS", label: "Banir membros", desc: "Remover membros sem que possam voltar." }
    ]
  },
  {
    title: "Permissões de canais de texto",
    perms: [
      { flag: "SEND_MESSAGES", label: "Enviar mensagens", desc: "Escrever nos canais de texto e no chat das calls." },
      { flag: "SEND_MESSAGES_IN_THREADS", label: "Enviar mensagens em tópicos", desc: "Responder dentro de tópicos." },
      { flag: "EMBED_LINKS", label: "Inserir links", desc: "Enviar mensagens com links." },
      { flag: "ATTACH_FILES", label: "Anexar arquivos", desc: "Enviar imagens, vídeos e arquivos." },
      { flag: "ADD_REACTIONS", label: "Adicionar reações", desc: "Reagir às mensagens com emojis." },
      { flag: "MANAGE_MESSAGES", label: "Gerenciar mensagens", desc: "Excluir mensagens de outras pessoas." },
      { flag: "PIN_MESSAGES", label: "Fixar mensagens", desc: "Fixar e desafixar mensagens." },
      { flag: "CREATE_POLLS", label: "Criar enquetes", desc: "Publicar enquetes nos canais." }
    ]
  },
  {
    title: "Permissões de canais de voz",
    perms: [
      { flag: "CONNECT_VOICE", label: "Conectar", desc: "Entrar nos canais de voz." },
      { flag: "SPEAK_VOICE", label: "Falar", desc: "Ser ouvido nas calls (sem ela, entra silenciado)." },
      { flag: "STREAM_VIDEO", label: "Vídeo / Compartilhar tela", desc: "Ligar a câmera e transmitir a tela." }
    ]
  },
  {
    title: "Permissão avançada",
    perms: [
      {
        flag: "ADMINISTRATOR",
        label: "Administrador",
        desc: "Concede todas as permissões do servidor. Cuidado ao dar esta permissão."
      }
    ]
  }
];

const ALL_FLAGS = PERMISSION_GROUPS.flatMap((g) => g.perms.map((p) => p.flag));

// What every member can do unless the server changes it (the "@everyone" set)
const DEFAULT_EVERYONE = [
  "CREATE_INSTANT_INVITE",
  "SEND_MESSAGES",
  "SEND_MESSAGES_IN_THREADS",
  "EMBED_LINKS",
  "ATTACH_FILES",
  "ADD_REACTIONS",
  "CREATE_POLLS",
  "CONNECT_VOICE",
  "SPEAK_VOICE",
  "STREAM_VIDEO"
];

// Names used by older versions of the app
const LEGACY = {
  MANAGE_GUILD: "MANAGE_SERVER",
  CONNECT: "CONNECT_VOICE",
  SPEAK: "SPEAK_VOICE",
  STREAM: "STREAM_VIDEO"
};

function normalizeFlags(list) {
  const out = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    const flag = LEGACY[raw] || raw;
    if (ALL_FLAGS.includes(flag)) out.add(flag);
  }
  return [...out];
}

module.exports = { PERMISSION_GROUPS, ALL_FLAGS, DEFAULT_EVERYONE, normalizeFlags };
