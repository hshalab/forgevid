/**
 * ForgeVid's daily self-marketing machine — the platform advertises itself.
 *
 * Renders vertical (9:16) marketing clips with karaoke captions using
 * ForgeVid's OWN pipeline (Pexels stock -> ElevenLabs narration -> Whisper
 * word-timing -> ffmpeg), from hand-authored scene scripts. Every topic is
 * BILINGUAL: each renders as <slug>-en.mp4 and <slug>-es.mp4 (same voice,
 * both languages) so EN and ES accounts can post in parallel. No DB, no
 * Redis; needs .env.local keys (PEXELS_API_KEY, ELEVENLABS_API_KEY,
 * OPENAI_API_KEY for Whisper captions).
 *
 *   npx tsx scripts/marketing-batch.ts                 # today's 2 topics x EN+ES (4 clips)
 *   npx tsx scripts/marketing-batch.ts --count 3       # 3 topics today (6 clips)
 *   npx tsx scripts/marketing-batch.ts --lang es       # Spanish only
 *   npx tsx scripts/marketing-batch.ts --topic dealer-inventory
 *   npx tsx scripts/marketing-batch.ts --list          # show all topics
 *   npx tsx scripts/marketing-batch.ts --email you@x.com   # ALSO email each clip
 *
 * Email delivery (post from your phone): pass --email or set MARKETING_EMAIL
 * in .env.local. Each clip arrives as its own email with the MP4 attached and
 * the post caption + hashtags in the body — save the attachment, open TikTok/
 * Instagram, paste the caption. Needs SMTP_* in .env.local (Resend works; with
 * forgevid.com verified there, set SMTP_FROM to noreply@forgevid.com).
 *
 * Narrations write urls as "dot com"/"punto com" so the voice says them
 * naturally; lib/captions normalizeSpokenUrls turns the captions back into
 * "ForgeVid.com" with karaoke timing intact.
 *
 * Cost: ~$0.15-0.30 per clip (TTS + Whisper; TTS cached by content, so
 * re-rendering the same topic is nearly free). Pexels is free.
 */
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

type Lang = 'en' | 'es';

interface MarketingScene {
  /** Concrete, high-availability Pexels query — abstract terms get no hits. */
  query: string;
  keywords: string[];
  narration: Record<Lang, string>;
}

interface MarketingTopic {
  slug: string;
  post: Record<Lang, { caption: string; hashtags: string }>;
  scenes: MarketingScene[];
}

const FORGEVID_TOPICS: MarketingTopic[] = [
  {
    slug: 'dealer-inventory',
    post: {
      en: {
        caption:
          'Your whole inventory, turned into videos, before your first coffee. Paste your feed — ForgeVid does the rest.',
        hashtags: '#cardealership #automarketing #AIvideo #dealerlife #carsales',
      },
      es: {
        caption:
          'Todo tu inventario convertido en videos, antes de tu primer café. Pega tu feed — ForgeVid hace el resto.',
        hashtags: '#concesionario #autosusados #videoAI #ventasdeautos #marketingautomotriz',
      },
    },
    scenes: [
      {
        query: 'car dealership lot',
        keywords: ['car showroom', 'cars parked'],
        narration: {
          en: 'Forty cars on your lot. Zero videos on your page. That gap is costing you buyers every single day.',
          es: 'Cuarenta autos en tu lote. Cero videos en tu página. Esa brecha te cuesta compradores todos los días.',
        },
      },
      {
        query: 'car showroom',
        keywords: ['luxury car interior', 'new car'],
        narration: {
          en: 'ForgeVid turns your inventory feed into a video for every vehicle — narrated, captioned, and branded.',
          es: 'ForgeVid convierte tu inventario en un video por cada vehículo — narrado, con subtítulos y con tu marca.',
        },
      },
      {
        query: 'salesman handshake car',
        keywords: ['car keys handover', 'happy customer car'],
        narration: {
          en: 'Price and specs burned into every clip. English and Spanish, same natural voice.',
          es: 'Precio y detalles en cada clip. En inglés y español, con la misma voz natural.',
        },
      },
      {
        query: 'pouring coffee cup',
        keywords: ['coffee cup desk', 'morning coffee'],
        narration: {
          en: 'Paste your feed. Pour a coffee. Post forty videos. ForgeVid dot com.',
          es: 'Pega tu feed. Sírvete un café. Publica cuarenta videos. ForgeVid punto com.',
        },
      },
    ],
  },
  {
    slug: 'url-to-video',
    post: {
      en: {
        caption:
          'Paste a website. Get a commercial. ForgeVid reads the page, writes the script, and uses the site’s own images.',
        hashtags: '#AIvideo #smallbusiness #videomarketing #contentcreation #startup',
      },
      es: {
        caption:
          'Pega un sitio web. Recibe un comercial. ForgeVid lee la página, escribe el guion y usa las imágenes del propio sitio.',
        hashtags: '#videoAI #negocios #marketingdigital #emprendedores #pymes',
      },
    },
    scenes: [
      {
        query: 'typing laptop close up',
        keywords: ['laptop keyboard', 'hands typing'],
        narration: {
          en: 'This is the laziest way to make a commercial ever invented. Watch closely.',
          es: 'Esta es la forma más fácil de hacer un comercial jamás inventada. Mira con atención.',
        },
      },
      {
        query: 'website design screen',
        keywords: ['computer screen webpage', 'scrolling website'],
        narration: {
          en: 'Paste any website into ForgeVid. It reads the page, writes the script from what it actually says, and pulls in the site’s own images.',
          es: 'Pega cualquier sitio web en ForgeVid. Lee la página, escribe el guion con lo que realmente dice, y usa las imágenes del propio sitio.',
        },
      },
      {
        query: 'video editing screen',
        keywords: ['video timeline', 'editing software'],
        narration: {
          en: 'A narrated, captioned commercial — grounded in your real product, not made-up claims.',
          es: 'Un comercial narrado y subtitulado — basado en tu producto real, sin promesas inventadas.',
        },
      },
      {
        query: 'person smiling phone',
        keywords: ['happy person smartphone', 'watching phone'],
        narration: {
          en: 'One link in. One commercial out. Try it at ForgeVid dot com.',
          es: 'Entra un enlace. Sale un comercial. Pruébalo en ForgeVid punto com.',
        },
      },
    ],
  },
  {
    slug: 'karaoke-captions',
    post: {
      en: {
        caption:
          'Word-by-word captions, timed by AI to the actual voiceover. The style that keeps viewers watching — built in.',
        hashtags: '#captions #reels #tiktokmarketing #AIvideo #videotips',
      },
      es: {
        caption:
          'Subtítulos palabra por palabra, sincronizados por IA con la voz real. El estilo que retiene a la audiencia — integrado.',
        hashtags: '#subtitulos #reels #tiktokespañol #videoAI #contenidodigital',
      },
    },
    scenes: [
      {
        query: 'person scrolling phone',
        keywords: ['smartphone scrolling', 'commuter phone'],
        narration: {
          en: 'Eighty percent of social video gets watched on mute. If your captions are boring, you already lost.',
          es: 'El ochenta por ciento de los videos se ven sin sonido. Si tus subtítulos aburren, ya perdiste.',
        },
      },
      {
        query: 'neon lights night',
        keywords: ['neon sign', 'colorful lights'],
        narration: {
          en: 'ForgeVid burns in karaoke captions — every word lights up exactly as it’s spoken.',
          es: 'ForgeVid graba subtítulos estilo karaoke — cada palabra se ilumina justo cuando se pronuncia.',
        },
      },
      {
        query: 'sound waveform screen',
        keywords: ['audio waveform', 'recording studio screen'],
        narration: {
          en: 'Not guessed. Timed by AI to the real voiceover, word by word.',
          es: 'Sin adivinar. Sincronizados por IA con la voz real, palabra por palabra.',
        },
      },
      {
        query: 'person pointing camera',
        keywords: ['pointing at camera', 'confident person'],
        narration: {
          en: 'These captions? Made by ForgeVid. Obviously. ForgeVid dot com.',
          es: '¿Estos subtítulos? Hechos con ForgeVid. Obvio. ForgeVid punto com.',
        },
      },
    ],
  },
  {
    slug: 'ten-languages',
    post: {
      en: {
        caption:
          'One video. Ten languages. Same natural voice in every one — Spanish, Chinese, Hindi, Japanese and more.',
        hashtags: '#multilingual #globalmarketing #AIvideo #translation #internationalbusiness',
      },
      es: {
        caption:
          'Un video. Diez idiomas. La misma voz natural en todos — inglés, chino, hindi, japonés y más.',
        hashtags: '#idiomas #marketingglobal #videoAI #traduccion #negociosinternacionales',
      },
    },
    scenes: [
      {
        query: 'world map globe',
        keywords: ['spinning globe', 'international flags'],
        narration: {
          en: 'Your customers don’t all speak English. Your videos shouldn’t either.',
          es: 'Tus clientes no hablan un solo idioma. Tus videos tampoco deberían.',
        },
      },
      {
        query: 'diverse people talking',
        keywords: ['multicultural people', 'people conversation'],
        narration: {
          en: 'ForgeVid narrates your videos in ten languages — Spanish, French, Chinese, Japanese, Hindi and more.',
          es: 'ForgeVid narra tus videos en diez idiomas — inglés, francés, chino, japonés, hindi y más.',
        },
      },
      {
        query: 'microphone studio',
        keywords: ['podcast microphone', 'voice recording'],
        narration: {
          en: 'Same natural voice across every language. Captions in the right script, every time.',
          es: 'La misma voz natural en cada idioma. Subtítulos en el alfabeto correcto, siempre.',
        },
      },
      {
        query: 'busy city crosswalk',
        keywords: ['crowd walking', 'city street people'],
        narration: {
          en: 'Speak to the whole market, not a tenth of it. ForgeVid dot com.',
          es: 'Háblale a todo el mercado, no a una parte. ForgeVid punto com.',
        },
      },
    ],
  },
  {
    slug: 'natural-voices',
    post: {
      en: {
        caption:
          'Eight natural AI voices, your own cloned voice, or your real recording. Your videos finally sound human.',
        hashtags: '#voiceover #AIvoice #contentcreator #videomarketing #texttospeech',
      },
      es: {
        caption:
          'Ocho voces naturales de IA, tu voz clonada o tu grabación real. Tus videos por fin suenan humanos.',
        hashtags: '#vozenoff #vozAI #creadordecontenido #videomarketing #locucion',
      },
    },
    scenes: [
      {
        query: 'robot toy',
        keywords: ['robot head', 'android machine'],
        narration: {
          en: 'You can always tell a robot voice. And so can your customers — right before they scroll past.',
          es: 'Una voz robótica se nota al instante. Tus clientes también la notan — justo antes de seguir de largo.',
        },
      },
      {
        query: 'microphone studio',
        keywords: ['radio host', 'voice actor studio'],
        narration: {
          en: 'ForgeVid uses natural voices that breathe, pause, and emphasize like real narrators.',
          es: 'ForgeVid usa voces naturales que respiran, pausan y dan énfasis como narradores reales.',
        },
      },
      {
        query: 'headphones listening',
        keywords: ['person headphones', 'listening music'],
        narration: {
          en: 'Pick from eight voices, clone your own, or upload your real recording. Preview each one before you commit.',
          es: 'Elige entre ocho voces, clona la tuya o sube tu propia grabación. Escucha cada una antes de decidir.',
        },
      },
      {
        query: 'person winking smiling',
        keywords: ['smiling face closeup', 'confident smile'],
        narration: {
          en: 'This voice? AI. Couldn’t tell, could you? ForgeVid dot com.',
          es: '¿Esta voz? Es IA. No se nota, ¿verdad? ForgeVid punto com.',
        },
      },
    ],
  },
  {
    slug: 'realestate-listings',
    post: {
      en: {
        caption:
          'Every listing deserves a video tour. Address, price, beds and baths — burned in automatically.',
        hashtags: '#realestate #realtor #listingvideo #AIvideo #realestatemarketing',
      },
      es: {
        caption:
          'Cada propiedad merece su video tour. Dirección, precio, cuartos y baños — integrados automáticamente.',
        hashtags: '#bienesraices #realtorlatino #propiedades #videoAI #inmobiliaria',
      },
    },
    scenes: [
      {
        query: 'modern house exterior',
        keywords: ['luxury home', 'house front yard'],
        narration: {
          en: 'Listings with video get four hundred percent more inquiries. So why does your newest listing have five photos and silence?',
          es: 'Las propiedades con video reciben cuatrocientos por ciento más consultas. ¿Y tu última propiedad tiene cinco fotos y silencio?',
        },
      },
      {
        query: 'modern house interior',
        keywords: ['living room interior', 'modern kitchen'],
        narration: {
          en: 'ForgeVid turns your listing feed into narrated video tours — the address, price, beds and baths burned right in.',
          es: 'ForgeVid convierte tus propiedades en video tours narrados — con dirección, precio, cuartos y baños en pantalla.',
        },
      },
      {
        query: 'real estate agent keys',
        keywords: ['house keys handover', 'realtor showing house'],
        narration: {
          en: 'Your own listing photos, Ken Burns motion, natural narration. Every listing, automatically.',
          es: 'Tus propias fotos, movimiento cinematográfico, narración natural. Cada propiedad, automáticamente.',
        },
      },
      {
        query: 'sold sign house',
        keywords: ['for sale sign', 'happy family house'],
        narration: {
          en: 'Twenty-five listings a batch. ForgeVid dot com.',
          es: 'Veinticinco propiedades por lote. ForgeVid punto com.',
        },
      },
    ],
  },
  {
    slug: 'speed-meta',
    post: {
      en: {
        caption:
          'This entire ad — script, voice, captions, footage — was made by the product it’s advertising. In 4 minutes.',
        hashtags: '#AIvideo #meta #videomarketing #automation #buildinpublic',
      },
      es: {
        caption:
          'Todo este anuncio — guion, voz, subtítulos — lo hizo el mismo producto que anuncia. En 4 minutos.',
        hashtags: '#videoAI #marketingdigital #emprendedores #automatizacion #negocios',
      },
    },
    scenes: [
      {
        query: 'video editing screen',
        keywords: ['computer video editing', 'timeline software'],
        narration: {
          en: 'Everything you’re watching right now — the script, this voice, these captions — was made by the product it’s advertising.',
          es: 'Todo lo que estás viendo — el guion, esta voz, estos subtítulos — lo hizo el mismo producto que se está anunciando.',
        },
      },
      {
        query: 'stopwatch timer',
        keywords: ['clock ticking', 'hourglass'],
        narration: {
          en: 'No editor. No agency. No camera. One prompt into ForgeVid, four minutes of rendering.',
          es: 'Sin editor. Sin agencia. Sin cámara. Una idea en ForgeVid, cuatro minutos de espera.',
        },
      },
      {
        query: 'rocket launch',
        keywords: ['rocket taking off', 'launch pad'],
        narration: {
          en: 'If it can sell itself, imagine what it does for your product.',
          es: 'Si puede venderse solo, imagina lo que hará por tu negocio.',
        },
      },
      {
        query: 'person smiling phone',
        keywords: ['happy person laptop', 'thumbs up'],
        narration: {
          en: 'Make yours at ForgeVid dot com.',
          es: 'Crea el tuyo en ForgeVid punto com.',
        },
      },
    ],
  },
  {
    slug: 'ecommerce-product',
    post: {
      en: {
        caption: 'Product feed in. Scroll-stopping reels out. Every SKU gets its own video.',
        hashtags: '#ecommerce #shopify #productvideo #AIvideo #onlinestore',
      },
      es: {
        caption: 'Entra tu catálogo. Salen reels que detienen el scroll. Cada producto con su propio video.',
        hashtags: '#ecommerce #tiendaonline #videoproducto #videoAI #ventasonline',
      },
    },
    scenes: [
      {
        query: 'online shopping phone',
        keywords: ['ecommerce phone', 'shopping app'],
        narration: {
          en: 'Product photos don’t stop thumbs. Video does — and your whole catalog has none.',
          es: 'Las fotos de producto no detienen el scroll. El video sí — y tu catálogo entero no tiene ninguno.',
        },
      },
      {
        query: 'product photography studio',
        keywords: ['product unboxing', 'package box'],
        narration: {
          en: 'ForgeVid turns your product feed into a vertical video for every single SKU.',
          es: 'ForgeVid convierte tu catálogo en un video vertical para cada producto.',
        },
      },
      {
        query: 'warehouse packages',
        keywords: ['delivery boxes', 'online store'],
        narration: {
          en: 'Your product shots, motion, narration, captions. Batch of twenty at a time.',
          es: 'Tus fotos de producto, movimiento, narración y subtítulos. Lotes de veinte a la vez.',
        },
      },
      {
        query: 'person smiling phone',
        keywords: ['influencer filming', 'happy shopper'],
        narration: {
          en: 'Your catalog wants to be famous. ForgeVid dot com.',
          es: 'Tu catálogo quiere ser famoso. ForgeVid punto com.',
        },
      },
    ],
  },
  {
    slug: 'presenter-pip',
    post: {
      en: {
        caption:
          'Put YOUR face on every video — presenter overlay in a corner while your product takes the screen.',
        hashtags: '#personalbrand #salesvideo #AIvideo #videoselling #realtorlife',
      },
      es: {
        caption:
          'Pon TU cara en cada video — tu imagen en una esquina mientras tu producto llena la pantalla.',
        hashtags: '#marcapersonal #ventas #videoAI #vendedores #realtorlatino',
      },
    },
    scenes: [
      {
        query: 'person talking camera',
        keywords: ['vlogger recording', 'selfie video'],
        narration: {
          en: 'People buy from people. But you can’t film yourself walking every car, every house, every product.',
          es: 'La gente le compra a la gente. Pero no puedes grabarte mostrando cada auto, cada casa, cada producto.',
        },
      },
      {
        query: 'picture in picture screen',
        keywords: ['video call screen', 'phone recording person'],
        narration: {
          en: 'ForgeVid puts your face in the corner while your inventory takes the screen — record yourself once.',
          es: 'ForgeVid pone tu cara en la esquina mientras tu inventario llena la pantalla — grábate una sola vez.',
        },
      },
      {
        query: 'confident business person',
        keywords: ['professional portrait', 'business smile'],
        narration: {
          en: 'Your voice as the narration. Your face on the video. Zero filming days.',
          es: 'Tu voz como narración. Tu cara en el video. Cero días de grabación.',
        },
      },
      {
        query: 'city timelapse',
        keywords: ['busy city', 'time lapse street'],
        narration: {
          en: 'Be everywhere without going anywhere. ForgeVid dot com.',
          es: 'Está en todas partes sin ir a ninguna. ForgeVid punto com.',
        },
      },
    ],
  },
  {
    slug: 'price-anchor',
    post: {
      en: {
        caption:
          'A video agency: $500 per video, 2-week turnaround. ForgeVid: your whole month of content for $29.',
        hashtags: '#marketingbudget #smallbusinessowner #AIvideo #contentmarketing #videoproduction',
      },
      es: {
        caption:
          'Una agencia: $500 por video y dos semanas de espera. ForgeVid: todo tu mes de contenido por $29.',
        hashtags: '#presupuesto #negociospequeños #videoAI #marketingdecontenidos #produccionaudiovisual',
      },
    },
    scenes: [
      {
        query: 'money counting cash',
        keywords: ['dollar bills', 'expensive invoice'],
        narration: {
          en: 'A production agency charges five hundred dollars per video and takes two weeks.',
          es: 'Una agencia de producción cobra quinientos dólares por video y tarda dos semanas.',
        },
      },
      {
        query: 'stopwatch timer',
        keywords: ['fast clock', 'speed'],
        narration: {
          en: 'ForgeVid renders a narrated, captioned video in about four minutes. Starting at twenty-nine dollars a month.',
          es: 'ForgeVid produce un video narrado y subtitulado en unos cuatro minutos. Desde veintinueve dólares al mes.',
        },
      },
      {
        query: 'video editing screen',
        keywords: ['professional editing', 'color grading screen'],
        narration: {
          en: 'Same polish. Natural voice, karaoke captions, your branding. A fraction of one agency invoice.',
          es: 'El mismo acabado. Voz natural, subtítulos karaoke, tu marca. Una fracción de una sola factura de agencia.',
        },
      },
      {
        query: 'calculator desk',
        keywords: ['calculating finances', 'budget planning'],
        narration: {
          en: 'Do the math, then do the demo. ForgeVid dot com.',
          es: 'Haz las cuentas, y luego haz la prueba. ForgeVid punto com.',
        },
      },
    ],
  },
];

// ────────────────────────────────────────────────────────────────────────────
// RingYield (Atiende) — the AI receptionist for HVAC & home-service shops.
// Value props mirror scripts/render-atiende-promo.ts: answers 24/7, triages
// name/address/urgency, escalates gas/smoke/flood, delivers booking-ready leads.
// ────────────────────────────────────────────────────────────────────────────
const RINGYIELD_TOPICS: MarketingTopic[] = [
  {
    slug: 'missed-calls',
    post: {
      en: {
        caption:
          'Every missed call is a job going to the shop down the street. RingYield answers every single one — 24/7.',
        hashtags: '#hvac #hvaclife #homeservices #smallbusiness #AIreceptionist',
      },
      es: {
        caption:
          'Cada llamada perdida es un trabajo que se va a la competencia. RingYield contesta todas — 24/7.',
        hashtags: '#airesacondicionados #serviciotecnico #negocios #recepcionistaAI #plomeria',
      },
    },
    scenes: [
      {
        query: 'hvac technician',
        keywords: ['air conditioner repair', 'technician working'],
        narration: {
          en: "Every call you miss is a job going to the shop down the street. And when you're on a roof or under a house, you miss a lot of them.",
          es: 'Cada llamada que pierdes es un trabajo que se va al taller de enfrente. Y cuando estás en un techo o debajo de una casa, pierdes muchas.',
        },
      },
      {
        query: 'call center headset',
        keywords: ['customer service', 'headset phone'],
        narration: {
          en: 'RingYield is the AI receptionist built for service shops. It answers every call, day or night, and never puts a customer on hold.',
          es: 'RingYield es la recepcionista de inteligencia artificial para talleres de servicio. Contesta cada llamada, de día o de noche, sin dejar a nadie en espera.',
        },
      },
      {
        query: 'email laptop',
        keywords: ['laptop inbox', 'office desk'],
        narration: {
          en: 'Every call becomes a booking-ready lead — name, number, and the problem — waiting in your inbox.',
          es: 'Cada llamada se convierte en un cliente listo para agendar — nombre, número y el problema — esperando en tu correo.',
        },
      },
      {
        query: 'technician smiling',
        keywords: ['handshake', 'happy worker'],
        narration: {
          en: 'Stop trading missed calls for lost revenue. RingYield dot com.',
          es: 'Deja de perder dinero por llamadas perdidas. RingYield punto com.',
        },
      },
    ],
  },
  {
    slug: 'after-hours',
    post: {
      en: {
        caption:
          'Your competitors close at 5. Your phone does not have to. RingYield books jobs while you sleep.',
        hashtags: '#hvacbusiness #plumbing #247service #homeservices #AIphone',
      },
      es: {
        caption:
          'Tu competencia cierra a las 5. Tu teléfono no tiene por qué. RingYield agenda trabajos mientras duermes.',
        hashtags: '#serviciotecnico #plomeria #negocio247 #emprendedores #AItelefono',
      },
    },
    scenes: [
      {
        query: 'city skyline night',
        keywords: ['night city', 'clock'],
        narration: {
          en: 'An AC dies at nine PM in July. Whoever answers that call gets the job. Will it be you?',
          es: 'Un aire acondicionado muere a las nueve de la noche en pleno julio. El que contesta esa llamada se queda con el trabajo. ¿Serás tú?',
        },
      },
      {
        query: 'phone ringing desk',
        keywords: ['smartphone ringing', 'telephone call'],
        narration: {
          en: 'RingYield answers your line around the clock — nights, weekends, and the middle of a two-hour install.',
          es: 'RingYield atiende tu línea a toda hora — noches, fines de semana y en plena instalación de dos horas.',
        },
      },
      {
        query: 'writing checklist',
        keywords: ['writing notes', 'clipboard'],
        narration: {
          en: 'It talks like a real front desk: gets the name, the address, and how urgent the problem is.',
          es: 'Habla como una recepcionista real: toma el nombre, la dirección y qué tan urgente es el problema.',
        },
      },
      {
        query: 'sunrise city',
        keywords: ['morning sunrise', 'coffee morning'],
        narration: {
          en: 'Wake up to booked jobs, not voicemails. RingYield dot com.',
          es: 'Despierta con trabajos agendados, no con mensajes de voz. RingYield punto com.',
        },
      },
    ],
  },
  {
    slug: 'emergency-safety',
    post: {
      en: {
        caption:
          'Gas leak? Smoke? Flooding? RingYield stops booking and escalates to you immediately — every time, no exceptions.',
        hashtags: '#hvac #safety #homeservices #plumbing #AIreceptionist',
      },
      es: {
        caption:
          '¿Fuga de gas? ¿Humo? ¿Inundación? RingYield deja de agendar y te escala la llamada de inmediato — siempre.',
        hashtags: '#seguridad #serviciotecnico #plomeria #emergencias #recepcionistaAI',
      },
    },
    scenes: [
      {
        query: 'warning sign',
        keywords: ['gas flame', 'caution tape'],
        narration: {
          en: 'Most phone bots treat every call the same. That is dangerous in this business.',
          es: 'La mayoría de los bots tratan todas las llamadas igual. En este negocio, eso es peligroso.',
        },
      },
      {
        query: 'call center headset',
        keywords: ['emergency call', 'operator phone'],
        narration: {
          en: 'RingYield knows its limits. Gas, smoke, or flooding — it stops booking and escalates to you immediately. Every time. No exceptions.',
          es: 'RingYield conoce sus límites. Gas, humo o inundación — deja de agendar y te escala la llamada de inmediato. Siempre. Sin excepciones.',
        },
      },
      {
        query: 'technician tools',
        keywords: ['repair tools', 'work gloves'],
        narration: {
          en: 'Routine calls get booked. Real emergencies get YOU. That is how a front desk should work.',
          es: 'Las llamadas de rutina se agendan. Las emergencias reales te llegan a TI. Así debe funcionar una recepción.',
        },
      },
      {
        query: 'handshake business',
        keywords: ['trust handshake', 'deal agreement'],
        narration: {
          en: 'Try to break it yourself — tell it you smell gas. RingYield dot com.',
          es: 'Ponlo a prueba tú mismo — dile que hueles gas. RingYield punto com.',
        },
      },
    ],
  },
  {
    slug: 'price-vs-receptionist',
    post: {
      en: {
        caption:
          'A full-time receptionist: $3,000+/month, one shift. RingYield: every call, every hour, a fraction of that.',
        hashtags: '#smallbusiness #hvacbusiness #savings #homeservices #automation',
      },
      es: {
        caption:
          'Una recepcionista de tiempo completo: más de $3,000 al mes, un turno. RingYield: cada llamada, a toda hora, por una fracción.',
        hashtags: '#negocios #ahorro #serviciotecnico #automatizacion #pymes',
      },
    },
    scenes: [
      {
        query: 'money counting cash',
        keywords: ['dollar bills', 'payroll money'],
        narration: {
          en: 'A front-desk hire costs three thousand a month — and only covers one shift, five days a week.',
          es: 'Una recepcionista cuesta tres mil al mes — y solo cubre un turno, cinco días a la semana.',
        },
      },
      {
        query: 'call center headset',
        keywords: ['phone operator', 'customer service desk'],
        narration: {
          en: 'RingYield covers every call, every hour, every day — including the two AM emergency that pays double.',
          es: 'RingYield cubre cada llamada, cada hora, todos los días — incluida la emergencia de las dos de la mañana que paga doble.',
        },
      },
      {
        query: 'calculator desk',
        keywords: ['calculating finances', 'budget planning'],
        narration: {
          en: 'No sick days. No hold music. No missed jobs. Do that math.',
          es: 'Sin días de enfermedad. Sin música de espera. Sin trabajos perdidos. Haz esa cuenta.',
        },
      },
      {
        query: 'technician smiling',
        keywords: ['happy worker', 'service van'],
        narration: {
          en: 'Your phones, handled. RingYield dot com.',
          es: 'Tus llamadas, resueltas. RingYield punto com.',
        },
      },
    ],
  },
];

// ────────────────────────────────────────────────────────────────────────────
// NeuroHires — AI-powered recruitment (www.neurohires.com). Claims kept broad
// and safe: faster shortlists, skills-based matching, no resume overload.
// ────────────────────────────────────────────────────────────────────────────
const NEUROHIRES_TOPICS: MarketingTopic[] = [
  {
    slug: 'resume-overload',
    post: {
      en: {
        caption:
          '400 resumes. One role. A weekend gone — or one AI shortlist in minutes. NeuroHires reads them all so you do not have to.',
        hashtags: '#recruiting #hiring #HRtech #talentacquisition #AIrecruiting',
      },
      es: {
        caption:
          '400 currículums. Un puesto. Un fin de semana perdido — o una lista corta con IA en minutos. NeuroHires los lee todos por ti.',
        hashtags: '#reclutamiento #contratacion #recursoshumanos #talento #AIreclutamiento',
      },
    },
    scenes: [
      {
        query: 'paperwork pile desk',
        keywords: ['stack of papers', 'busy office desk'],
        narration: {
          en: 'Four hundred resumes for one role. Your best candidate is in there — buried on page nine.',
          es: 'Cuatrocientos currículums para un solo puesto. Tu mejor candidato está ahí — enterrado en la página nueve.',
        },
      },
      {
        query: 'laptop dashboard office',
        keywords: ['computer screen data', 'software dashboard'],
        narration: {
          en: 'NeuroHires reads every application and shortlists the people who can actually do the job.',
          es: 'NeuroHires lee cada solicitud y preselecciona a las personas que realmente pueden hacer el trabajo.',
        },
      },
      {
        query: 'job interview handshake',
        keywords: ['interview meeting', 'office handshake'],
        narration: {
          en: 'You spend your time interviewing finalists, not skimming PDFs.',
          es: 'Tú dedicas tu tiempo a entrevistar finalistas, no a hojear archivos.',
        },
      },
      {
        query: 'happy team office',
        keywords: ['team celebration', 'office high five'],
        narration: {
          en: 'Hire smarter, not later. NeuroHires dot com.',
          es: 'Contrata mejor, no más tarde. NeuroHires punto com.',
        },
      },
    ],
  },
  {
    slug: 'speed-to-hire',
    post: {
      en: {
        caption:
          'The best candidates are off the market in days. If your hiring process takes weeks, you are hiring the leftovers.',
        hashtags: '#hiring #recruitment #talentwar #HRtech #startups',
      },
      es: {
        caption:
          'Los mejores candidatos desaparecen del mercado en días. Si tu proceso tarda semanas, contratas lo que queda.',
        hashtags: '#contratacion #reclutamiento #talento #recursoshumanos #startups',
      },
    },
    scenes: [
      {
        query: 'person walking fast city',
        keywords: ['business person walking', 'busy street suit'],
        narration: {
          en: 'The best candidates are off the market in ten days. Your hiring process takes six weeks.',
          es: 'Los mejores candidatos salen del mercado en diez días. Tu proceso de contratación tarda seis semanas.',
        },
      },
      {
        query: 'laptop dashboard office',
        keywords: ['fast typing computer', 'software screen'],
        narration: {
          en: 'NeuroHires screens and ranks applicants the moment they apply — your shortlist is ready the same day.',
          es: 'NeuroHires filtra y clasifica a los candidatos en cuanto aplican — tu lista corta está lista el mismo día.',
        },
      },
      {
        query: 'stopwatch timer',
        keywords: ['clock ticking', 'hourglass'],
        narration: {
          en: 'Move first, and the talent says yes to YOU.',
          es: 'Muévete primero, y el talento te dice que sí a TI.',
        },
      },
      {
        query: 'job interview handshake',
        keywords: ['welcome aboard', 'new employee'],
        narration: {
          en: 'Speed wins hires. NeuroHires dot com.',
          es: 'La velocidad gana contrataciones. NeuroHires punto com.',
        },
      },
    ],
  },
  {
    slug: 'skills-matching',
    post: {
      en: {
        caption:
          'Keyword filters reject great people for formatting. NeuroHires matches on what candidates can actually DO.',
        hashtags: '#recruiting #skillsbasedhiring #HRtech #hiringbias #talent',
      },
      es: {
        caption:
          'Los filtros de palabras clave rechazan gente valiosa por el formato. NeuroHires evalúa lo que los candidatos saben HACER.',
        hashtags: '#reclutamiento #talento #recursoshumanos #contratacionjusta #habilidades',
      },
    },
    scenes: [
      {
        query: 'frustrated office worker',
        keywords: ['stressed person computer', 'head in hands desk'],
        narration: {
          en: 'Keyword filters reject brilliant people because their resume used the wrong word.',
          es: 'Los filtros de palabras clave rechazan a gente brillante porque su currículum usó la palabra equivocada.',
        },
      },
      {
        query: 'laptop dashboard office',
        keywords: ['data analytics screen', 'profile matching'],
        narration: {
          en: 'NeuroHires matches on skills and real experience — what people can do, not what they typed.',
          es: 'NeuroHires evalúa habilidades y experiencia real — lo que la gente sabe hacer, no lo que escribió.',
        },
      },
      {
        query: 'diverse people talking',
        keywords: ['diverse team office', 'candidates waiting'],
        narration: {
          en: 'Better matches. Fairer process. Stronger teams.',
          es: 'Mejores coincidencias. Un proceso más justo. Equipos más fuertes.',
        },
      },
      {
        query: 'happy team office',
        keywords: ['team success', 'office celebration'],
        narration: {
          en: 'Find the ones the filters miss. NeuroHires dot com.',
          es: 'Encuentra a los que los filtros ignoran. NeuroHires punto com.',
        },
      },
    ],
  },
  {
    slug: 'cost-of-vacancy',
    post: {
      en: {
        caption:
          'An empty seat is not free — it costs you output, deadlines and team morale every single day. Fill it faster.',
        hashtags: '#hiring #business #productivity #HRtech #recruiting',
      },
      es: {
        caption:
          'Un puesto vacío no es gratis — te cuesta producción, plazos y moral del equipo cada día. Llénalo más rápido.',
        hashtags: '#contratacion #negocios #productividad #recursoshumanos #equipos',
      },
    },
    scenes: [
      {
        query: 'empty office desk',
        keywords: ['empty chair office', 'vacant desk'],
        narration: {
          en: 'That empty seat on your team costs you every single day — missed deadlines, burned-out teammates, stalled projects.',
          es: 'Ese puesto vacío en tu equipo te cuesta todos los días — plazos incumplidos, compañeros agotados, proyectos detenidos.',
        },
      },
      {
        query: 'stressed team meeting',
        keywords: ['overworked office', 'tired employees'],
        narration: {
          en: 'Every week the role stays open, the rest of your team pays for it.',
          es: 'Cada semana que el puesto sigue abierto, el resto de tu equipo lo paga.',
        },
      },
      {
        query: 'laptop dashboard office',
        keywords: ['hiring software', 'candidate list screen'],
        narration: {
          en: 'NeuroHires cuts the time from opening a role to signing the right person.',
          es: 'NeuroHires acorta el tiempo entre abrir la vacante y firmar a la persona correcta.',
        },
      },
      {
        query: 'new employee welcome',
        keywords: ['first day work', 'welcome handshake'],
        narration: {
          en: 'Stop paying for empty chairs. NeuroHires dot com.',
          es: 'Deja de pagar por sillas vacías. NeuroHires punto com.',
        },
      },
    ],
  },
  // ── Candidate-side topics (job seekers, not employers) — hooks adapted from
  // the 2026-07 TikTok strategy. Claims deliberately qualitative: no invented
  // statistics, and the CTA points at the ATS tool that actually exists at
  // neurohires.com/en/tools (verified live 2026-07-26).
  {
    slug: 'ats-filter',
    post: {
      en: {
        caption:
          'Your resume is not getting rejected by people. At many companies, software filters it before a human ever opens it. Score yours at NeuroHires.com.',
        hashtags: '#resume #jobsearch #ATS #careertips #jobhunt',
      },
      es: {
        caption:
          'Tu currículum no lo rechaza una persona. En muchas empresas, un software lo filtra antes de que un humano lo abra. Evalúa el tuyo en NeuroHires.com.',
        hashtags: '#curriculum #empleo #trabajo #consejoslaborales #busquedadeempleo',
      },
    },
    scenes: [
      {
        query: 'person laptop rejection sad',
        keywords: ['job application computer', 'frustrated laptop user'],
        narration: {
          en: 'Your resume is not getting rejected by people. At many companies, software filters it before a human ever opens it.',
          es: 'Tu currículum no lo rechaza una persona. En muchas empresas, un software lo filtra antes de que un humano lo abra.',
        },
      },
      {
        query: 'software screen scanning document',
        keywords: ['document scan screen', 'data processing computer'],
        narration: {
          en: 'These systems rank applications by how well they match the job description — and recruiters mostly look at the top of that list.',
          es: 'Esos sistemas clasifican las solicitudes según qué tanto coinciden con la vacante — y los reclutadores miran sobre todo la parte alta de esa lista.',
        },
      },
      {
        query: 'person editing document laptop',
        keywords: ['writing resume laptop', 'editing text screen'],
        narration: {
          en: 'So use the words the job posting uses, keep the format simple, and lead with what matches.',
          es: 'Así que usa las palabras del anuncio, mantén un formato simple y destaca primero lo que coincide.',
        },
      },
      {
        query: 'confident person phone smile',
        keywords: ['happy person phone', 'smiling professional'],
        narration: {
          en: 'See how your resume scores before you apply. NeuroHires dot com.',
          es: 'Mira cómo puntúa tu currículum antes de aplicar. NeuroHires punto com.',
        },
      },
    ],
  },
  {
    slug: 'ats-myth',
    post: {
      en: {
        caption:
          '"75% of resumes are auto-rejected by AI" — that stat is basically made up. Here is what is actually true, and why it still matters.',
        hashtags: '#resume #ATS #jobsearch #mythbusting #careeradvice',
      },
      es: {
        caption:
          '"El 75% de los currículums los rechaza una IA" — ese dato es básicamente inventado. Esto es lo que sí es cierto, y por qué igual importa.',
        hashtags: '#curriculum #empleo #mitos #consejoslaborales #trabajo',
      },
    },
    scenes: [
      {
        query: 'fake news warning screen',
        keywords: ['warning sign screen', 'person skeptical phone'],
        narration: {
          en: 'You have seen the claim: seventy-five percent of resumes get auto-rejected by AI. Nobody can actually back that number up.',
          es: 'Seguro viste el dato: el setenta y cinco por ciento de los currículums los rechaza una IA. Nadie puede realmente respaldar ese número.',
        },
      },
      {
        query: 'office computer recruiter working',
        keywords: ['recruiter screen office', 'HR software'],
        narration: {
          en: 'What IS true: many companies use software to rank applications, and humans mostly read the ones ranked highest.',
          es: 'Lo que SÍ es cierto: muchas empresas usan software para clasificar solicitudes, y los humanos leen sobre todo las mejor clasificadas.',
        },
      },
      {
        query: 'person typing laptop focus',
        keywords: ['focused typing', 'laptop close up hands'],
        narration: {
          en: 'You do not need to fear a robot. You need to rank higher — clear titles, matching skills, simple formatting.',
          es: 'No tienes que temerle a un robot. Tienes que clasificar más alto — títulos claros, habilidades que coincidan, formato simple.',
        },
      },
      {
        query: 'confident person phone smile',
        keywords: ['satisfied professional', 'person smiling laptop'],
        narration: {
          en: 'Check where you stand at NeuroHires dot com.',
          es: 'Mira dónde estás parado en NeuroHires punto com.',
        },
      },
    ],
  },
  {
    slug: 'apply-smarter',
    post: {
      en: {
        caption:
          'Stop applying to 100 jobs with the same resume. 10 tailored applications beat 100 generic ones — here is the move.',
        hashtags: '#jobsearch #careertips #resume #jobhunt #interviews',
      },
      es: {
        caption:
          'Deja de aplicar a 100 empleos con el mismo currículum. 10 solicitudes personalizadas ganan a 100 genéricas — este es el método.',
        hashtags: '#empleo #trabajo #curriculum #consejoslaborales #entrevistas',
      },
    },
    scenes: [
      {
        query: 'person tired laptop night',
        keywords: ['exhausted computer user', 'late night laptop'],
        narration: {
          en: 'A hundred applications, three replies. The problem is not your effort — it is the shotgun approach.',
          es: 'Cien solicitudes, tres respuestas. El problema no es tu esfuerzo — es aplicar a todo sin apuntar.',
        },
      },
      {
        query: 'person writing notes planning',
        keywords: ['planning notebook desk', 'making list'],
        narration: {
          en: 'Pick ten roles you actually match. Rewrite your top three bullet points for each one, using the words from that posting.',
          es: 'Elige diez puestos donde realmente encajas. Reescribe tus tres primeros logros para cada uno, con las palabras de ese anuncio.',
        },
      },
      {
        query: 'email notification phone',
        keywords: ['phone notification', 'checking messages'],
        narration: {
          en: 'Tailored resumes rank higher in the software AND read better to the human — that is where callbacks come from.',
          es: 'Un currículum personalizado clasifica más alto en el software Y convence más al humano — de ahí salen las llamadas.',
        },
      },
      {
        query: 'confident person phone smile',
        keywords: ['happy candidate', 'good news phone'],
        narration: {
          en: 'Test each version before you send it. NeuroHires dot com.',
          es: 'Prueba cada versión antes de enviarla. NeuroHires punto com.',
        },
      },
    ],
  },
  {
    slug: 'interview-one-thing',
    post: {
      en: {
        caption:
          'Strong candidates rarely bomb interviews because of nerves. It is usually this one thing — and it is fixable tonight.',
        hashtags: '#interviews #interviewtips #jobsearch #careeradvice #hiring',
      },
      es: {
        caption:
          'Los buenos candidatos casi nunca fallan la entrevista por nervios. Suele ser esta única cosa — y se arregla esta noche.',
        hashtags: '#entrevistas #empleo #trabajo #consejoslaborales #contratacion',
      },
    },
    scenes: [
      {
        query: 'nervous person interview waiting',
        keywords: ['waiting room interview', 'nervous professional'],
        narration: {
          en: 'Strong candidates usually do not bomb interviews because of nerves. They bomb because they answer in generalities.',
          es: 'Los buenos candidatos no suelen fallar por nervios. Fallan porque responden con generalidades.',
        },
      },
      {
        query: 'job interview conversation office',
        keywords: ['interview meeting two people', 'office conversation'],
        narration: {
          en: '"I am a team player" convinces nobody. A specific story — the problem, what YOU did, the result — is what interviewers remember.',
          es: '"Trabajo bien en equipo" no convence a nadie. Una historia concreta — el problema, lo que TÚ hiciste, el resultado — es lo que se recuerda.',
        },
      },
      {
        query: 'person writing notes planning',
        keywords: ['preparing notes', 'writing notebook'],
        narration: {
          en: 'Tonight: write down five specific stories from your work. One per common question. That is the whole fix.',
          es: 'Esta noche: escribe cinco historias concretas de tu trabajo. Una por pregunta típica. Ese es todo el arreglo.',
        },
      },
      {
        query: 'job interview handshake',
        keywords: ['successful interview', 'handshake office'],
        narration: {
          en: 'Walk in with stories, not adjectives. More at NeuroHires dot com.',
          es: 'Llega con historias, no con adjetivos. Más en NeuroHires punto com.',
        },
      },
    ],
  },
  {
    slug: 'resume-first-three',
    post: {
      en: {
        caption:
          'Recruiters decide in seconds. These are the three things they look at first on your resume — fix these before anything else.',
        hashtags: '#resume #careertips #jobsearch #recruiting #jobhunt',
      },
      es: {
        caption:
          'Los reclutadores deciden en segundos. Estas son las tres cosas que miran primero en tu currículum — arregla esto antes que nada.',
        hashtags: '#curriculum #empleo #consejoslaborales #reclutamiento #trabajo',
      },
    },
    scenes: [
      {
        query: 'recruiter reading resume office',
        keywords: ['reading document office', 'reviewing papers'],
        narration: {
          en: 'Recruiters skim before they read. Three things get looked at first — get these right and the rest gets read.',
          es: 'Los reclutadores hojean antes de leer. Tres cosas se miran primero — acierta en ellas y leerán el resto.',
        },
      },
      {
        query: 'resume document closeup',
        keywords: ['resume paper closeup', 'cv document'],
        narration: {
          en: 'One: your last job title — does it sound like the role? Two: your dates — steady, recent, no mystery gaps.',
          es: 'Uno: tu último puesto — ¿suena al rol que buscan? Dos: tus fechas — estables, recientes, sin huecos misteriosos.',
        },
      },
      {
        query: 'person editing document laptop',
        keywords: ['editing resume screen', 'laptop document work'],
        narration: {
          en: 'Three: the top third of page one. Your best, most relevant wins go there — not an objective paragraph.',
          es: 'Tres: el primer tercio de la primera página. Ahí van tus logros más relevantes — no un párrafo de objetivos.',
        },
      },
      {
        query: 'confident person phone smile',
        keywords: ['confident professional', 'person smiling phone'],
        narration: {
          en: 'See what a recruiter sees. NeuroHires dot com.',
          es: 'Mira lo que ve un reclutador. NeuroHires punto com.',
        },
      },
    ],
  },
];

/** All brands the engine advertises. Rotation runs per brand, every day. */
const BRANDS: Record<string, MarketingTopic[]> = {
  forgevid: FORGEVID_TOPICS,
  ringyield: RINGYIELD_TOPICS,
  neurohires: NEUROHIRES_TOPICS,
};

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const langArg = (get('--lang') || 'both') as Lang | 'both';
  const brand = (get('--brand') || 'all').toLowerCase();
  return {
    list: args.includes('--list'),
    brand,
    // All-brands mode defaults to 1 topic per brand (3 brands x 2 langs = 6
    // clips/day); a single brand defaults to 2 topics.
    count: Number(get('--count')) || (brand === 'all' ? 1 : 2),
    langs: (langArg === 'both' ? ['en', 'es'] : [langArg]) as Lang[],
    topic: get('--topic'),
    email: get('--email') || process.env.MARKETING_EMAIL || undefined,
  };
}

/** Resend caps attachments well above this; 20MB keeps every inbox happy. */
const MAX_ATTACH_BYTES = 20 * 1024 * 1024;

/**
 * Email one rendered clip so it can be posted straight from a phone. Failures
 * never fail the batch — the file is on disk either way.
 */
async function emailClip(
  to: string,
  brand: string,
  topic: MarketingTopic,
  lang: Lang,
  filePath: string,
  fileBytes: number,
): Promise<void> {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS || process.env.SMTP_PASS.includes('PASTE')) {
    console.log('    email: SMTP not configured in .env.local — skipped (fill SMTP_PASS with your Resend API key)');
    return;
  }
  const nodemailer = (await import('nodemailer')).default;
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.resend.com',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  const post = topic.post[lang];
  const attach = fileBytes <= MAX_ATTACH_BYTES;
  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || 'ForgeVid <noreply@forgevid.com>',
      to,
      subject: `📱 [${brand.toUpperCase()}] [${lang.toUpperCase()}] Post this: ${topic.slug}`,
      text:
        `Caption (copy-paste):\n\n${post.caption}\n\n${post.hashtags}\n\n` +
        (attach
          ? 'The clip is attached — save it to your camera roll and post.'
          : `Clip is ${(fileBytes / 1e6).toFixed(1)}MB (too big to attach) — grab it from ${filePath}.`),
      attachments: attach
        ? [{ filename: `${brand}-${topic.slug}-${lang}.mp4`, path: filePath, contentType: 'video/mp4' }]
        : [],
    });
    console.log(`    email: sent to ${to}${attach ? ' (clip attached)' : ' (caption only — clip too large)'}`);
  } catch (error) {
    console.error(`    email FAILED (${error instanceof Error ? error.message : error}) — clip is still at ${filePath}`);
  }
}

async function main() {
  const fs = await import('fs');
  const path = await import('path');
  const opts = parseArgs();

  if (opts.list) {
    for (const [brand, topics] of Object.entries(BRANDS)) {
      console.log(`${brand}:`);
      for (const t of topics) console.log(`  ${t.slug}`);
    }
    return;
  }

  const brandKeys =
    opts.brand === 'all' ? Object.keys(BRANDS) : Object.keys(BRANDS).filter((b) => b === opts.brand);
  if (brandKeys.length === 0) {
    console.error(`Unknown brand "${opts.brand}". Use one of: all, ${Object.keys(BRANDS).join(', ')}`);
    process.exit(1);
  }

  // Rotate by day-of-year so consecutive days post different topics without
  // any state to remember. Each brand rotates through its own topic list.
  const now = new Date();
  const dayOfYear = Math.floor((now.getTime() - Date.UTC(now.getUTCFullYear(), 0, 0)) / 86400000);
  const picked: Array<{ brand: string; topic: MarketingTopic }> = [];
  for (const brand of brandKeys) {
    let pool = BRANDS[brand];
    if (opts.topic) {
      pool = pool.filter((t) => t.slug === opts.topic);
      if (pool.length === 0) continue; // topic may belong to another brand
    }
    const start = opts.topic ? 0 : (dayOfYear * opts.count) % pool.length;
    const take = opts.topic ? pool.length : Math.min(opts.count, pool.length);
    for (let i = 0; i < take; i++) picked.push({ brand, topic: pool[(start + i) % pool.length] });
  }
  if (picked.length === 0) {
    console.error(`Unknown topic "${opts.topic}". Use --list to see all.`);
    process.exit(1);
  }

  const date = now.toISOString().slice(0, 10);
  const outDir = path.join(process.cwd(), 'marketing-out', date);
  fs.mkdirSync(outDir, { recursive: true });
  const postsFile = path.join(outDir, 'POST-THESE.md');

  const { resolveSceneClips, assembleVideo } = await import('../lib/video-generator');
  const { synthesizeSceneVoiceovers } = await import('../lib/voiceover');
  const { CAPTION_PRESETS } = await import('../lib/captions');

  const jobs = picked.length * opts.langs.length;
  console.log(`Rendering ${jobs} clip(s) (${picked.length} topic(s) x ${opts.langs.join('+')}) -> ${outDir}\n`);
  let rendered = 0;

  for (const { brand, topic } of picked) {
    for (const lang of opts.langs) {
      const outPath = path.join(outDir, `${brand}-${topic.slug}-${lang}.mp4`);
      if (fs.existsSync(outPath)) {
        console.log(`- ${brand}/${topic.slug} [${lang}]: already rendered today, skipping render.`);
        if (opts.email) {
          await emailClip(opts.email, brand, topic, lang, outPath, fs.statSync(outPath).size);
        }
        continue;
      }
      console.log(`- ${brand}/${topic.slug} [${lang}] (${topic.scenes.length} scenes)`);

      try {
        const planned = topic.scenes.map((s, i) => ({
          id: `scene-${i + 1}`,
          index: i,
          description: s.narration[lang],
          narration: s.narration[lang],
          searchQuery: s.query,
          keywords: s.keywords,
          duration: 2, // narration paces each scene
          visualElements: [] as string[],
        }));

        const resolved = await resolveSceneClips(planned as any, '9:16');
        console.log(`    stock: ${resolved.length}/${planned.length} scenes matched`);

        const sceneVoiceovers = await synthesizeSceneVoiceovers(
          resolved.map((s: any) => ({ id: s.id, description: s.narration })),
          process.env.ELEVENLABS_VOICE_ID ?? null,
        );
        if (!sceneVoiceovers) throw new Error('narration synthesis failed (ELEVENLABS_API_KEY?)');

        const { videoUrl, cues } = await assembleVideo(resolved as any, ['voiceover', 'subtitles'], '9:16', {
          sceneVoiceovers,
          voiceId: process.env.ELEVENLABS_VOICE_ID ?? null,
          transition: null, // hard cuts keep length matched to paced audio
          renderQuality: 'full',
          captionStyle: CAPTION_PRESETS.karaoke,
          captionAnimation: 'karaoke',
          language: lang,
        });

        // Collect the result into today's folder: local paths are copied, and a
        // Cloudinary URL (when CLOUDINARY_* is configured) is downloaded.
        if (videoUrl.startsWith('/')) {
          fs.copyFileSync(path.join(process.cwd(), 'public', videoUrl.replace(/^\/+/, '')), outPath);
        } else {
          const res = await fetch(videoUrl);
          if (!res.ok) throw new Error(`could not download render (${res.status})`);
          fs.writeFileSync(outPath, Buffer.from(await res.arrayBuffer()));
        }

        const post = topic.post[lang];
        fs.appendFileSync(
          postsFile,
          `## ${brand}-${topic.slug}-${lang}.mp4\n\n${post.caption}\n\n${post.hashtags}\n\n---\n\n`,
        );
        rendered++;
        console.log(`    done: ${outPath} (${cues.length} caption cues)`);

        if (opts.email) {
          await emailClip(opts.email, brand, topic, lang, outPath, fs.statSync(outPath).size);
        }
      } catch (error) {
        console.error(`    FAILED: ${error instanceof Error ? error.message : error}`);
        console.error('    (continuing with the next clip — re-run to retry this one)');
      }
    }
  }

  console.log(`\n${rendered}/${jobs} clip(s) rendered.`);
  if (rendered > 0) {
    console.log(`Post them: open ${postsFile} for paste-ready captions + hashtags.`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('\nBatch failed:', e);
  process.exit(1);
});
